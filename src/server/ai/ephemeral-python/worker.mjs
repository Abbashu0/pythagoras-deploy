import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";

const PYTHON_RUNNER = String.raw`
import ast
import contextlib
import io

ALLOWED_IMPORTS = {"math", "cmath", "statistics", "fractions", "decimal", "sympy", "numpy"}
FORBIDDEN_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint",
    "globals", "locals", "getattr", "setattr", "delattr", "vars",
}
RESULT_NAME = "_pythagoras_last_expression"

class LimitWriter:
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.size = 0
        self.truncated = False

    def write(self, value):
        text = str(value)
        remaining = self.limit - self.size
        if remaining <= 0:
            self.truncated = True
            return len(text)
        encoded = text.encode("utf-8")
        if len(encoded) > remaining:
            text = encoded[:remaining].decode("utf-8", "ignore")
            self.truncated = True
        self.parts.append(text)
        self.size += len(text.encode("utf-8"))
        return len(value)

    def flush(self):
        return None

    def value(self):
        text = "".join(self.parts)
        return text + ("\n[output truncated]" if self.truncated else "")

def validate_tree(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".", 1)[0]
                if root not in ALLOWED_IMPORTS:
                    raise ValueError(f"Import is not allowed: {root}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".", 1)[0]
            if node.level != 0 or root not in ALLOWED_IMPORTS:
                raise ValueError(f"Import is not allowed: {root or 'relative'}")
            if any(alias.name.startswith("__") for alias in node.names):
                raise ValueError("Dunder imports are not allowed")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("Dunder attribute access is not allowed")
        elif isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in FORBIDDEN_NAMES:
                raise ValueError(f"Name is not allowed: {node.id}")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise ValueError(f"Call is not allowed: {node.func.id}")

def execute(source):
    tree = ast.parse(source, filename="<python>", mode="exec")
    validate_tree(tree)
    last = tree.body[-1] if tree.body else None
    if isinstance(last, ast.Expr):
        tree.body[-1] = ast.Assign(
            targets=[ast.Name(id=RESULT_NAME, ctx=ast.Store())],
            value=last.value,
        )
        ast.copy_location(tree.body[-1], last)
        ast.fix_missing_locations(tree)

    stdout = LimitWriter(32 * 1024)
    stderr = LimitWriter(16 * 1024)
    scope = {"__name__": "__main__"}
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        exec(compile(tree, "<python>", "exec"), scope, scope)

    result = scope.get(RESULT_NAME, None)
    result_text = None if result is None else repr(result)
    if result_text is not None and len(result_text.encode("utf-8")) > 32 * 1024:
        result_text = result_text.encode("utf-8")[:32 * 1024].decode("utf-8", "ignore") + "\n[result truncated]"
    return {
        "status": "ok",
        "stdout": stdout.value(),
        "result": result_text,
        "stderr": stderr.value(),
    }
`;

async function main() {
  try {
    const pyodide = await loadPyodide({ stdout: () => {}, stderr: () => {} });
    await pyodide.loadPackage(["numpy", "sympy"]);
    parentPort?.postMessage({ type: "ready" });
    parentPort?.once("message", async (message) => {
      if (message?.type !== "execute") return;
      try {
        const source = String(message.code ?? "");
        if (Buffer.byteLength(source, "utf8") > 12 * 1024) {
          throw new Error("Python code exceeds the 12 KB limit.");
        }
        pyodide.globals.set("_source_code", source);
        const result = await pyodide.runPythonAsync(`${PYTHON_RUNNER}\nexecute(_source_code)`);
        parentPort?.postMessage({
          type: "result",
          result: result?.toJs ? result.toJs({ dict_converter: Object.fromEntries }) : result,
        });
        result?.destroy?.();
      } catch (error) {
        parentPort?.postMessage({
          type: "result",
          result: {
            status: "error",
            errorType: error?.name || "PythonError",
            message: safePythonMessage(error),
          },
        });
      }
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "bootstrap_error",
      errorType: error?.name || "PythonRuntimeError",
      message: safePythonMessage(error),
    });
  }
}

function safePythonMessage(error) {
  const raw = String(error?.message || error || "Python execution failed.");
  const lastLine = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) || "Python execution failed.";
  return lastLine.replace(/[A-Za-z]:\\[^\s]+/gu, "<path>").slice(0, 16 * 1024);
}

void main();
