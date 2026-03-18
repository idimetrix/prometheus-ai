/**
 * Phase 9.3: AST Parser using TypeScript Compiler API.
 *
 * Instead of tree-sitter (native dependency issues), we use the
 * TypeScript compiler API to parse TS/JS files and extract:
 *  - Functions (name, params, return type, exported, async)
 *  - Classes (name, extends, implements, methods, properties)
 *  - Imports (source, specifiers, kind)
 *  - Exports (name, kind)
 *  - Interfaces and type aliases
 *
 * This produces a structured SymbolTable that can be fed into the
 * knowledge graph and convention extractor.
 */

import { createLogger } from "@prometheus/logger";
import ts from "typescript";
import type {
  ParsedClass,
  ParsedExport,
  ParsedFunction,
  ParsedImport,
  ParsedInterface,
  SymbolTable,
} from "./symbols";

const logger = createLogger("project-brain:parser");

/**
 * Parse a TypeScript or JavaScript file and extract its symbol table.
 */
export function parseTypeScript(
  filePath: string,
  content: string
): SymbolTable {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const symbols: SymbolTable = {
    filePath,
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    interfaces: [],
    typeAliases: [],
    variables: [],
  };

  visitNode(sourceFile, symbols, sourceFile);

  logger.debug(
    {
      filePath,
      functions: symbols.functions.length,
      classes: symbols.classes.length,
      imports: symbols.imports.length,
      exports: symbols.exports.length,
    },
    "File parsed with TS compiler API"
  );

  return symbols;
}

function visitNode(
  node: ts.Node,
  symbols: SymbolTable,
  sourceFile: ts.SourceFile
): void {
  // ─── Function declarations ───────────────────────────────────
  if (ts.isFunctionDeclaration(node) && node.name) {
    const fn = extractFunction(node, sourceFile);
    if (fn) {
      symbols.functions.push(fn);
    }
  }

  // ─── Arrow / function expression assigned to const ───────────
  if (ts.isVariableStatement(node)) {
    const isExported = hasExportModifier(node);
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (
          ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer)
        ) {
          const fn = extractArrowFunction(
            decl,
            decl.initializer,
            isExported,
            sourceFile
          );
          if (fn) {
            symbols.functions.push(fn);
          }
        } else {
          // Regular variable
          symbols.variables.push({
            name: decl.name.text,
            exported: isExported,
            kind: ts.isVariableDeclarationList(node.declarationList)
              ? node.declarationList.flags & ts.NodeFlags.Const
                ? "const"
                : node.declarationList.flags & ts.NodeFlags.Let
                  ? "let"
                  : "var"
              : "const",
            type: decl.type ? decl.type.getText(sourceFile) : undefined,
            line: getLineNumber(decl, sourceFile),
          });
        }
      }
    }
  }

  // ─── Class declarations ──────────────────────────────────────
  if (ts.isClassDeclaration(node) && node.name) {
    const cls = extractClass(node, sourceFile);
    if (cls) {
      symbols.classes.push(cls);
    }
  }

  // ─── Import declarations ─────────────────────────────────────
  if (ts.isImportDeclaration(node)) {
    const imp = extractImport(node, sourceFile);
    if (imp) {
      symbols.imports.push(imp);
    }
  }

  // ─── Export declarations ─────────────────────────────────────
  if (ts.isExportDeclaration(node)) {
    const exps = extractExportDeclaration(node, sourceFile);
    symbols.exports.push(...exps);
  }

  // Named exports on declarations (export function, export class, etc.)
  if (hasExportModifier(node)) {
    const name = getDeclarationName(node);
    if (name) {
      const kind = getDeclarationKind(node);
      symbols.exports.push({
        name,
        kind,
        isDefault: hasDefaultModifier(node),
        line: getLineNumber(node, sourceFile),
      });
    }
  }

  // Export default expression
  if (ts.isExportAssignment(node)) {
    const name = node.expression.getText(sourceFile);
    symbols.exports.push({
      name,
      kind: "default",
      isDefault: true,
      line: getLineNumber(node, sourceFile),
    });
  }

  // ─── Interface declarations ──────────────────────────────────
  if (ts.isInterfaceDeclaration(node)) {
    const iface = extractInterface(node, sourceFile);
    if (iface) {
      symbols.interfaces.push(iface);
    }
  }

  // ─── Type alias declarations ─────────────────────────────────
  if (ts.isTypeAliasDeclaration(node)) {
    symbols.typeAliases.push({
      name: node.name.text,
      exported: hasExportModifier(node),
      type: node.type.getText(sourceFile),
      line: getLineNumber(node, sourceFile),
    });
  }

  ts.forEachChild(node, (child) => visitNode(child, symbols, sourceFile));
}

// ─── Extractors ──────────────────────────────────────────────────

function extractFunction(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile
): ParsedFunction | null {
  if (!node.name) {
    return null;
  }

  return {
    name: node.name.text,
    params: node.parameters.map((p) => ({
      name: p.name.getText(sourceFile),
      type: p.type ? p.type.getText(sourceFile) : undefined,
      optional: !!p.questionToken,
    })),
    returnType: node.type ? node.type.getText(sourceFile) : undefined,
    exported: hasExportModifier(node),
    isAsync: !!node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    ),
    isGenerator: !!node.asteriskToken,
    line: getLineNumber(node, sourceFile),
    endLine: getEndLineNumber(node, sourceFile),
  };
}

function extractArrowFunction(
  decl: ts.VariableDeclaration,
  init: ts.ArrowFunction | ts.FunctionExpression,
  exported: boolean,
  sourceFile: ts.SourceFile
): ParsedFunction | null {
  if (!ts.isIdentifier(decl.name)) {
    return null;
  }

  return {
    name: decl.name.text,
    params: init.parameters.map((p) => ({
      name: p.name.getText(sourceFile),
      type: p.type ? p.type.getText(sourceFile) : undefined,
      optional: !!p.questionToken,
    })),
    returnType: init.type ? init.type.getText(sourceFile) : undefined,
    exported,
    isAsync: !!init.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    ),
    isGenerator: false,
    line: getLineNumber(decl, sourceFile),
    endLine: getEndLineNumber(decl, sourceFile),
  };
}

function extractClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): ParsedClass | null {
  if (!node.name) {
    return null;
  }

  const methods: ParsedFunction[] = [];
  const properties: Array<{
    name: string;
    type?: string;
    visibility?: string;
  }> = [];

  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) && member.name) {
      const name = member.name.getText(sourceFile);
      methods.push({
        name,
        params: member.parameters.map((p) => ({
          name: p.name.getText(sourceFile),
          type: p.type ? p.type.getText(sourceFile) : undefined,
          optional: !!p.questionToken,
        })),
        returnType: member.type ? member.type.getText(sourceFile) : undefined,
        exported: false,
        isAsync: !!member.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.AsyncKeyword
        ),
        isGenerator: false,
        line: getLineNumber(member, sourceFile),
        endLine: getEndLineNumber(member, sourceFile),
        visibility: getVisibility(member),
      });
    }

    if (ts.isPropertyDeclaration(member) && member.name) {
      properties.push({
        name: member.name.getText(sourceFile),
        type: member.type ? member.type.getText(sourceFile) : undefined,
        visibility: getVisibility(member),
      });
    }
  }

  // Extract heritage clauses (extends, implements)
  let extendsClause: string | undefined;
  const implementsList: string[] = [];

  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        extendsClause = clause.types[0]?.expression.getText(sourceFile);
      }
      if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const type of clause.types) {
          implementsList.push(type.expression.getText(sourceFile));
        }
      }
    }
  }

  return {
    name: node.name.text,
    exported: hasExportModifier(node),
    isAbstract: !!node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AbstractKeyword
    ),
    extends: extendsClause,
    implements: implementsList.length > 0 ? implementsList : undefined,
    methods,
    properties,
    line: getLineNumber(node, sourceFile),
    endLine: getEndLineNumber(node, sourceFile),
  };
}

function extractImport(
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile
): ParsedImport | null {
  const moduleSpecifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) {
    return null;
  }

  const source = moduleSpecifier.text;
  const specifiers: string[] = [];
  let isDefault = false;
  let isNamespace = false;

  const clause = node.importClause;
  if (clause) {
    // Default import
    if (clause.name) {
      specifiers.push(clause.name.text);
      isDefault = true;
    }

    // Named bindings
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        specifiers.push(clause.namedBindings.name.text);
        isNamespace = true;
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          specifiers.push(el.name.text);
        }
      }
    }
  }

  return {
    source,
    specifiers,
    isDefault,
    isNamespace,
    isTypeOnly: !!clause?.isTypeOnly,
    line: getLineNumber(node, sourceFile),
  };
}

function extractExportDeclaration(
  node: ts.ExportDeclaration,
  sourceFile: ts.SourceFile
): ParsedExport[] {
  const exports: ParsedExport[] = [];

  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) {
      exports.push({
        name: el.name.text,
        kind: "re-export",
        isDefault: false,
        source: node.moduleSpecifier
          ? (node.moduleSpecifier as ts.StringLiteral).text
          : undefined,
        line: getLineNumber(el, sourceFile),
      });
    }
  } else if (node.moduleSpecifier) {
    // export * from "module"
    exports.push({
      name: "*",
      kind: "namespace-export",
      isDefault: false,
      source: (node.moduleSpecifier as ts.StringLiteral).text,
      line: getLineNumber(node, sourceFile),
    });
  }

  return exports;
}

function extractInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile
): ParsedInterface {
  const members: Array<{ name: string; type: string; optional: boolean }> = [];

  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name) {
      members.push({
        name: member.name.getText(sourceFile),
        type: member.type ? member.type.getText(sourceFile) : "unknown",
        optional: !!member.questionToken,
      });
    }
  }

  // Extract extends
  const extendsList: string[] = [];
  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      for (const type of clause.types) {
        extendsList.push(type.expression.getText(sourceFile));
      }
    }
  }

  return {
    name: node.name.text,
    exported: hasExportModifier(node),
    extends: extendsList.length > 0 ? extendsList : undefined,
    members,
    line: getLineNumber(node, sourceFile),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  );
}

function getDeclarationName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isInterfaceDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isEnumDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) {
      return decl.name.text;
    }
  }
  return null;
}

function getDeclarationKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) {
    return "function";
  }
  if (ts.isClassDeclaration(node)) {
    return "class";
  }
  if (ts.isInterfaceDeclaration(node)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return "type";
  }
  if (ts.isEnumDeclaration(node)) {
    return "enum";
  }
  if (ts.isVariableStatement(node)) {
    return "variable";
  }
  return "unknown";
}

function getVisibility(
  member: ts.ClassElement
): "public" | "private" | "protected" | undefined {
  if (!ts.canHaveModifiers(member)) {
    return undefined;
  }
  const modifiers = ts.getModifiers(member);
  if (!modifiers) {
    return undefined;
  }

  for (const mod of modifiers) {
    if (mod.kind === ts.SyntaxKind.PrivateKeyword) {
      return "private";
    }
    if (mod.kind === ts.SyntaxKind.ProtectedKeyword) {
      return "protected";
    }
    if (mod.kind === ts.SyntaxKind.PublicKeyword) {
      return "public";
    }
  }
  return undefined;
}

function getLineNumber(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function getEndLineNumber(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}
