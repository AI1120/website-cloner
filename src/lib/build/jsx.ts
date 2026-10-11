import ts from "typescript";

/** Attribute that tags rendered elements with their place in the source. */
const LOC_ATTRIBUTE = "data-sc-loc";

const SCRIPT_EXTENSION = /\.(?:jsx?|tsx?|mjs)$/i;

export function isScriptFile(file: string): boolean {
  return SCRIPT_EXTENSION.test(file);
}

function parse(file: string, source: string): ts.SourceFile {
  const kind = /\.tsx$/i.test(file)
    ? ts.ScriptKind.TSX
    : /\.ts$/i.test(file)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Collapses whitespace the way the browser does when showing text. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Adds `data-sc-loc="file:line:column"` to every HTML element written in JSX,
 * so an element picked in the preview can be traced back to its source.
 */
export function tagJsxLocations(source: string, file: string): string {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parse(file, source);
  } catch {
    return source;
  }

  const inserts: { at: number; text: string }[] = [];
  walk(sourceFile, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    // Lowercase names are HTML elements; components would not pass the attribute on.
    if (!ts.isIdentifier(node.tagName) || !/^[a-z]/.test(node.tagName.text)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    inserts.push({
      at: node.tagName.end,
      text: ` ${LOC_ATTRIBUTE}="${file}:${line + 1}:${character + 1}"`,
    });
  });

  let output = source;
  for (const insert of inserts.sort((a, b) => b.at - a.at)) {
    output = output.slice(0, insert.at) + insert.text + output.slice(insert.at);
  }
  return output;
}

function jsxTextFor(value: string): string {
  // Braces and angle brackets would be read as JSX, so those go in a string.
  return /[{}<>]/.test(value) ? `{${JSON.stringify(value)}}` : value;
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return source.slice(0, start) + value + source.slice(end);
}

/** Replaces a JSX text node's words, keeping the whitespace around them. */
function replaceJsxText(source: string, node: ts.JsxText, after: string): string {
  const raw = source.slice(node.pos, node.end);
  const leading = /^\s*/.exec(raw)?.[0] ?? "";
  const trailing = /\s*$/.exec(raw)?.[0] ?? "";
  return replaceRange(source, node.pos, node.end, `${leading}${jsxTextFor(after)}${trailing}`);
}

function replaceStringLiteral(
  source: string,
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
  after: string,
  sourceFile: ts.SourceFile,
): string {
  const start = node.getStart(sourceFile);
  // Inside a JSX attribute a string can't use backslash escapes.
  const inAttribute = ts.isJsxAttribute(node.parent);
  const replacement = inAttribute
    ? `"${after.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
    : JSON.stringify(after);
  return replaceRange(source, start, node.end, replacement);
}

/**
 * Changes a piece of text that sits directly inside the JSX element at
 * `line:column`. Returns the new source, or null when the element or the text
 * can't be found there (for example when the text comes from a variable).
 */
export function editJsxText(
  source: string,
  file: string,
  line: number,
  column: number,
  before: string,
  after: string,
): string | null {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parse(file, source);
  } catch {
    return null;
  }
  let position: number;
  try {
    position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    return null;
  }

  const wanted = normalizeText(before);
  let result: string | null = null;
  walk(sourceFile, (node) => {
    if (result !== null || !ts.isJsxElement(node)) return;
    if (node.openingElement.getStart(sourceFile) !== position) return;

    const textMatches = node.children.filter(
      (child): child is ts.JsxText => ts.isJsxText(child) && normalizeText(child.text) === wanted,
    );
    if (textMatches.length === 1) {
      result = replaceJsxText(source, textMatches[0], after);
      return;
    }
    const literalMatches = node.children.flatMap((child) => {
      if (!ts.isJsxExpression(child) || !child.expression) return [];
      const expression = child.expression;
      return (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) &&
        normalizeText(expression.text) === wanted
        ? [expression]
        : [];
    });
    if (literalMatches.length === 1) {
      result = replaceStringLiteral(source, literalMatches[0], after, sourceFile);
    }
  });
  return result;
}

export interface SourceText {
  path: string;
  source: string;
}

/**
 * Finds text that appears exactly once across the given files, as JSX text or
 * as a string, and replaces it. Used when the text on screen comes from data
 * (a list of features, say) rather than from the element that shows it.
 */
export function editUniqueText(
  files: SourceText[],
  before: string,
  after: string,
): SourceText | null {
  const wanted = normalizeText(before);
  if (!wanted) return null;
  const matches: { file: SourceText; apply: () => string }[] = [];

  for (const file of files) {
    if (!file.source.includes(wanted.slice(0, Math.min(12, wanted.length)))) continue;
    let sourceFile: ts.SourceFile;
    try {
      sourceFile = parse(file.path, file.source);
    } catch {
      continue;
    }
    walk(sourceFile, (node) => {
      if (ts.isJsxText(node)) {
        if (normalizeText(node.text) === wanted) {
          matches.push({ file, apply: () => replaceJsxText(file.source, node, after) });
        }
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // Import paths and the like are strings too, but never visible text.
        if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return;
        if (normalizeText(node.text) === wanted) {
          matches.push({
            file,
            apply: () => replaceStringLiteral(file.source, node, after, sourceFile),
          });
        }
      }
    });
    if (matches.length > 1) return null;
  }

  if (matches.length !== 1) return null;
  return { path: matches[0].file.path, source: matches[0].apply() };
}

export interface FoundRoute {
  /** Route path as written, joined with its parents, e.g. "/pricing". */
  path: string;
  /** Name of the component the route renders, when it is a plain `<Name />`. */
  component: string | null;
  /** File the route is declared in. */
  declaredIn: string;
}

export interface FileLinks {
  /** In-app destinations found in the file, e.g. "/pricing". */
  targets: string[];
  /** Relative imports: local name → module specifier. */
  imports: Map<string, string>;
}

function stringAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    const value = attribute.initializer;
    if (!value) return "";
    if (ts.isStringLiteral(value)) return value.text;
    if (ts.isJsxExpression(value) && value.expression) {
      const expression = value.expression;
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
      }
    }
    return null;
  }
  return null;
}

function hasAttribute(attributes: ts.JsxAttributes, name: string): boolean {
  return attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

function elementComponent(attributes: ts.JsxAttributes): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "element") continue;
    const value = attribute.initializer;
    if (!value || !ts.isJsxExpression(value) || !value.expression) return null;
    const expression = value.expression;
    const tag = ts.isJsxSelfClosingElement(expression)
      ? expression.tagName
      : ts.isJsxElement(expression)
        ? expression.openingElement.tagName
        : null;
    return tag && ts.isIdentifier(tag) ? tag.text : null;
  }
  return null;
}

function joinRoute(parent: string, child: string): string {
  if (child.startsWith("/")) return child;
  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return `${base}${child}`.replace(/\/+$/, "") || "/";
}

function linkTarget(value: string | null): string | null {
  if (!value) return null;
  const target = value.startsWith("#/") ? value.slice(1) : value;
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  return target.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

/** Reads the routes a file declares with react-router's `<Route>`. */
export function findRoutes(source: string, file: string): FoundRoute[] {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parse(file, source);
  } catch {
    return [];
  }
  const routes: FoundRoute[] = [];

  const visit = (node: ts.Node, parentPath: string): void => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && ts.isIdentifier(opening.tagName) && opening.tagName.text === "Route") {
      const written = stringAttribute(opening.attributes, "path");
      const isIndex = hasAttribute(opening.attributes, "index");
      const fullPath = written ? joinRoute(parentPath, written) : parentPath;
      if (ts.isJsxElement(node)) {
        // A route with child routes is a layout; its index child is the screen at its path.
        for (const child of node.children) visit(child, fullPath);
      } else if ((written !== null || isIndex) && !fullPath.includes("*")) {
        routes.push({
          path: fullPath,
          component: elementComponent(opening.attributes),
          declaredIn: file,
        });
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, parentPath));
  };
  visit(sourceFile, "/");

  const seen = new Set<string>();
  return routes.filter((route) => (seen.has(route.path) ? false : (seen.add(route.path), true)));
}

/** Reads a file's relative imports and the in-app places it links to. */
export function findLinks(source: string, file: string): FileLinks {
  const links: FileLinks = { targets: [], imports: new Map() };
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parse(file, source);
  } catch {
    return links;
  }
  const targets = new Set<string>();

  walk(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) return;
      const clause = node.importClause;
      if (clause?.name) links.imports.set(clause.name.text, specifier);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) links.imports.set(element.name.text, specifier);
      }
      // Imports used only for their side effects still pull the file in.
      if (!clause) links.imports.set(`side-effect:${specifier}`, specifier);
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const name of ["to", "href"]) {
        const target = linkTarget(stringAttribute(node.attributes, name));
        if (target) targets.add(target);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:navigate|redirect)$/.test(node.expression.text)
    ) {
      const [first] = node.arguments;
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        const target = linkTarget(first.text);
        if (target) targets.add(target);
      }
    }
  });

  links.targets = [...targets];
  return links;
}

/** A CSS property name (font-size) as a React style key (fontSize); custom properties stay quoted. */
function styleKey(property: string): string {
  return property.startsWith("--")
    ? JSON.stringify(property)
    : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Sets or removes inline style properties on the HTML element written in JSX
 * that starts at `line:column` (as tagged by `tagJsxLocations`), through its
 * `style={{ … }}` prop. `changes` maps CSS property names to values, or to
 * null to remove one. Returns the new source, or null when the element isn't
 * there.
 */
export function editJsxStyle(
  source: string,
  file: string,
  line: number,
  column: number,
  changes: Record<string, string | null>,
): string | null {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parse(file, source);
  } catch {
    return null;
  }
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  walk(sourceFile, (node) => {
    if (found.length > 0 || (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))) return;
    const at = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    if (at.line + 1 === line && at.character + 1 === column) found.push(node);
  });
  const target = found[0];
  if (!target) return null;

  const entries = Object.entries(changes);
  const set = entries
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([property, value]) => `${styleKey(property)}: ${JSON.stringify(value)}`);
  const render = (items: string[]) => (items.length === 0 ? "{}" : `{ ${items.join(", ")} }`);
  const style = target.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "style",
  );

  if (!style) {
    if (set.length === 0) return source;
    return replaceRange(source, target.tagName.end, target.tagName.end, ` style={${render(set)}}`);
  }
  const expression =
    style.initializer && ts.isJsxExpression(style.initializer) ? style.initializer.expression : undefined;
  if (!expression) return null;

  if (ts.isObjectLiteralExpression(expression)) {
    const changed = new Set(entries.map(([property]) => styleKey(property)));
    const kept = expression.properties
      .filter((property) => {
        const name =
          ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
        if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) return true;
        return !changed.has(name.text) && !changed.has(JSON.stringify(name.text));
      })
      .map((property) => property.getText(sourceFile));
    return replaceRange(source, expression.getStart(sourceFile), expression.end, render([...kept, ...set]));
  }

  // style={someObject}: keep it, and override after it.
  const overrides = entries.map(
    ([property, value]) => `${styleKey(property)}: ${value === null ? "undefined" : JSON.stringify(value)}`,
  );
  return replaceRange(
    source,
    expression.getStart(sourceFile),
    expression.end,
    render([`...${expression.getText(sourceFile)}`, ...overrides]),
  );
}
