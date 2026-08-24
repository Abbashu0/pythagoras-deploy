import { assertCanonicalRichDocument } from "../questions/canonical-rich-document";
import type { CanonicalRichDocument } from "../questions";
import type { RichDocumentEditorState } from "./contracts";

/** The editor state is deliberately editor-neutral; no HTML or library-native JSON is persisted. */
export function canonicalToEditorState(document: CanonicalRichDocument): RichDocumentEditorState {
  assertCanonicalRichDocument(document);
  return { document: structuredClone(document) };
}

export function editorStateToCanonical(state: RichDocumentEditorState): CanonicalRichDocument {
  const document = structuredClone(state.document);
  assertCanonicalRichDocument(document);
  return document;
}
