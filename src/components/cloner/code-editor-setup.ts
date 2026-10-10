import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";

/**
 * CodeMirror for the Code view, loaded on demand by `CodeEditor`. Colours come
 * from the theme tokens in globals.css, so the editor follows light and dark mode
 * without being rebuilt.
 */

export interface EditorCallbacks {
  onChange: (value: string) => void;
  onSave: () => void;
}

export interface MountedEditor {
  /** Replaces the text, e.g. after the file was reloaded from disk. */
  setValue: (value: string) => void;
  setWrap: (wrap: boolean) => void;
  focus: () => void;
  destroy: () => void;
}

function languageFor(path: string): Extension {
  const name = path.toLowerCase();
  if (/\.(?:html?|svg|xml|vue)$/.test(name)) return html();
  if (/\.(?:css|scss|less)$/.test(name)) return css();
  if (/\.(?:json|webmanifest)$/.test(name) || name.endsWith(".map")) return json();
  if (/\.(?:md|markdown|mdx)$/.test(name)) return markdown();
  if (/\.(?:[cm]?jsx?)$/.test(name)) return javascript({ jsx: true });
  if (/\.(?:[cm]?tsx?)$/.test(name)) return javascript({ jsx: true, typescript: true });
  return [];
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: "var(--code-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.tagName, tags.typeName, tags.className, tags.namespace], color: "var(--code-tag)" },
  { tag: [tags.attributeName, tags.propertyName, tags.definition(tags.propertyName)], color: "var(--code-attribute)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: "var(--code-function)" },
  { tag: [tags.definition(tags.variableName), tags.labelName], color: "var(--foreground)" },
  { tag: [tags.heading], color: "var(--code-tag)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--code-string)", textDecoration: "underline" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.strong], fontWeight: "600" },
  { tag: [tags.angleBracket, tags.bracket, tags.punctuation, tags.separator], color: "var(--code-punctuation)" },
  { tag: [tags.invalid], color: "var(--destructive)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 16px 0 8px" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--code-comment)",
    border: "none",
    paddingLeft: "8px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--brand) 22%, transparent) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--brand) 12%, transparent)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--brand) 18%, transparent)",
    outline: "none",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    borderRadius: "4px",
    padding: "0 4px",
  },
  ".cm-panels": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-search": { fontFamily: "var(--font-sans)", fontSize: "12px", padding: "6px 10px" },
  ".cm-search input, .cm-search button, .cm-textfield": {
    fontFamily: "inherit",
    fontSize: "12px",
    borderRadius: "6px",
    border: "1px solid var(--input)",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    backgroundImage: "none",
    padding: "3px 8px",
  },
  ".cm-search label": { fontSize: "12px", color: "var(--muted-foreground)" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklch, var(--code-number) 25%, transparent)",
    outline: "1px solid color-mix(in oklch, var(--code-number) 50%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklch, var(--brand) 35%, transparent)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

/** Creates the editor inside `parent`. */
export function mountEditor(
  parent: HTMLElement,
  options: { value: string; path: string; wrap: boolean; label: string },
  callbacks: { current: EditorCallbacks },
): MountedEditor {
  const wrapping = new Compartment();
  let applyingOutside = false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              callbacks.current.onSave();
              return true;
            },
          },
        ]),
        languageFor(options.path),
        syntaxHighlighting(highlight),
        theme,
        wrapping.of(options.wrap ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ "aria-label": options.label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingOutside) callbacks.current.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    setValue(value) {
      const current = view.state.doc.toString();
      if (current === value) return;
      applyingOutside = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      applyingOutside = false;
    },
    setWrap(wrap) {
      view.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
