#!/usr/bin/env python3
"""Test-only inventory/discovery/result gates. Standard library; no app runtime use."""
import argparse
import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def seconds(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a test duration")
    if isinstance(value, str):
        value = value.strip()
        if re.fullmatch(r"\d+(?:\.\d+)?(?:ms|s)", value):
            factor = 0.001 if value.endswith("ms") else 1
            value = float(value[:-2] if factor == 0.001 else value[:-1]) * factor
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError("Missing/invalid test duration")
    return value


def method_id(value, class_name):
    match = re.search(r"(?:^|[/.])" + re.escape(class_name) + r"/(test\w+)(?:\(\))?$", value)
    return match[1] if match else None


def discover(data, expected, class_name):
    found = [method_id(value, class_name) for value in strings(data)]
    found = {name for name in found if name}
    if found != set(expected):
        raise ValueError(f"Compiled discovery mismatch: missing={sorted(set(expected)-found)}, unexpected={sorted(found-set(expected))}")
    return sorted(found)


def manifest(root):
    module = Path(root) / "mobile/modules/pythagoras-chat-preview"
    result = {}
    for key, relative in [("hosted", "ios-tests/NativePreviewLayoutTests.swift"),
                          ("foundation", "tests/FittedPreviewGeometryTests.swift")]:
        source = (module / relative).read_text(encoding="utf-8")
        names = re.findall(r"^  func (test\w+)\(\)", source, re.M)
        if not names or len(names) != len(set(names)):
            raise ValueError("Empty/duplicate source test inventory")
        result[key] = sorted(names)
    result["production_source_sha256"] = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((module / "ios").glob("*.swift"))
    }
    return result


def simulator(devices, runtimes):
    candidates = []
    for runtime in runtimes["runtimes"]:
        if not runtime.get("isAvailable") or ".iOS-" not in runtime["identifier"]:
            continue
        version = tuple(int(n) for n in runtime["version"].split("."))
        for device in devices["devices"].get(runtime["identifier"], []):
            if device.get("isAvailable") and device["name"].startswith("iPhone"):
                candidates.append((version, device["state"] == "Booted", device["name"], device, runtime))
    if not candidates:
        raise ValueError("No installed available iPhone/iOS Simulator; no guessed destination")
    _, _, _, device, runtime = sorted(candidates, key=lambda item: item[:3], reverse=True)[0]
    if not re.fullmatch(r"[0-9A-Fa-f-]{36}", device["udid"]):
        raise ValueError("Invalid simulator identifier")
    return {"udid": device["udid"], "name": device["name"], "state": device["state"],
            "runtime": runtime["name"], "runtime_version": runtime["version"]}


def foundation(xml_path, inventory, discovery_text):
    discovered = discover(discovery_text.splitlines(), inventory["foundation"], "FittedPreviewGeometryTests")
    # CLI discovery is line-oriented, not one giant identifier string.
    rows = []
    for node in ET.parse(xml_path).iter("testcase"):
        if not node.attrib.get("classname", "").endswith("FittedPreviewGeometryTests"):
            raise ValueError("Unexpected Foundation test class")
        status = "Failed" if node.find("failure") is not None or node.find("error") is not None else (
            "Skipped" if node.find("skipped") is not None else "Passed")
        rows.append({"name": node.attrib["name"].removesuffix("()"), "result": status,
                     "seconds": seconds(node.attrib["time"])})
    return validate(rows, inventory["foundation"], discovered)


def case_nodes(value):
    if isinstance(value, dict):
        if value.get("nodeType") == "Test Case":
            yield value
        else:
            for child in value.values():
                yield from case_nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from case_nodes(child)


def validate(rows, expected, discovered):
    names = [row["name"] for row in rows]
    issues = []
    if len(names) != len(set(names)) or set(names) != set(expected):
        issues.append("Executed test identities do not match source/compiled discovery")
    passed = sum(row["result"] == "Passed" for row in rows)
    failed = sum(row["result"] == "Failed" for row in rows)
    skipped = sum(row["result"] == "Skipped" for row in rows)
    if passed != len(expected) or failed or skipped:
        issues.append("Every expected test must execute and pass; failures/skips/unknown outcomes are fatal")
    return {"discovered": len(discovered), "executed": len(rows), "passed": passed,
            "failed": failed, "skipped": skipped, "issues": issues,
            "sum_test_seconds": sum(row["seconds"] for row in rows),
            "slowest": sorted(rows, key=lambda row: row["seconds"], reverse=True)[:5]}


def hosted(tree, summary, inventory, discovery, destination):
    discovered = discover(discovery, inventory["hosted"], "NativePreviewLayoutTests")
    rows = []
    for node in case_nodes(tree):
        name = node.get("nodeIdentifier", node.get("name", ""))
        method = re.search(r"(?:^|/)(test\w+)(?:\(\))?$", name)
        if not method:
            raise ValueError("Unrecognized xcresult test identity")
        duration = node.get("durationInSeconds", node.get("duration"))
        rows.append({"name": method[1], "result": node.get("result"), "seconds": seconds(duration)})
    result = validate(rows, inventory["hosted"], discovered)
    if destination["udid"] not in set(strings(summary)):
        result["issues"].append("xcresult summary does not prove the selected simulator UDID")
    for field, actual in [("totalTestCount", result["executed"]), ("passedTests", result["passed"]),
                          ("failedTests", result["failed"]), ("skippedTests", result["skipped"])]:
        if summary.get(field) != actual:
            result["issues"].append(f"xcresult summary disagrees with executed rows: {field}")
    result["simulator"] = destination
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["manifest", "simulator", "foundation", "discovery", "hosted"])
    parser.add_argument("--root")
    parser.add_argument("--inventory")
    parser.add_argument("--devices")
    parser.add_argument("--runtimes")
    parser.add_argument("--xml")
    parser.add_argument("--discovery")
    parser.add_argument("--summary")
    parser.add_argument("--tree")
    parser.add_argument("--destination")
    parser.add_argument("--output", required=True)
    parser.add_argument("--wall-seconds", type=float)
    args = parser.parse_args()
    if args.mode == "manifest":
        result = manifest(args.root)
    elif args.mode == "simulator":
        result = simulator(load(args.devices), load(args.runtimes))
    elif args.mode == "discovery":
        result = {"hosted": discover(load(args.discovery), load(args.inventory)["hosted"], "NativePreviewLayoutTests")}
    elif args.mode == "foundation":
        # Split the actual SwiftPM list into individual identifiers.
        inventory = load(args.inventory)
        text = Path(args.discovery).read_text(encoding="utf-8")
        discovered = discover(text.splitlines(), inventory["foundation"], "FittedPreviewGeometryTests")
        result = foundation(args.xml, inventory, text)
        result["discovered"] = len(discovered)
    else:
        result = hosted(load(args.tree), load(args.summary), load(args.inventory),
                        load(args.discovery), load(args.destination))
    if args.wall_seconds is not None:
        result["invocation_wall_seconds"] = seconds(args.wall_seconds)
    save(args.output, result)
    print(json.dumps(result, ensure_ascii=False))
    if result.get("issues"):
        raise ValueError("; ".join(result["issues"]))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, ET.ParseError) as error:
        print(f"NATIVE TEST REPORT ERROR: {error}", file=sys.stderr)
        sys.exit(1)
