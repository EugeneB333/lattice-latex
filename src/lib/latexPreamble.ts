export interface LatexPreambleInsertion {
  offset: number;
  text: string;
  addedPackages: string[];
}

interface PackageDeclaration {
  names: string[];
  options: string[];
  start: number;
  end: number;
}

function sourceWithoutComments(source: string): string {
  return source.split("\n").map((line) => {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "%") continue;
      let slashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashCount += 1;
      if (slashCount % 2 === 0) return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
    }
    return line;
  }).join("\n");
}

function declarations(source: string): PackageDeclaration[] {
  const clean = sourceWithoutComments(source);
  const documentStart = clean.search(/\\begin\s*\{document\}/);
  const preamble = clean.slice(0, documentStart < 0 ? clean.length : documentStart);
  const result: PackageDeclaration[] = [];
  const expression = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  for (const match of preamble.matchAll(expression)) {
    result.push({
      names: match[2].split(",").map((name) => name.trim()).filter(Boolean),
      options: (match[1] ?? "").split(",").map((option) => option.trim()).filter(Boolean),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return result;
}

function afterLine(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline < 0 ? source.length : newline + 1;
}

function beforeLine(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return newline < 0 ? 0 : newline + 1;
}

function defaultInsertionOffset(source: string, packages: PackageDeclaration[]): number {
  if (packages.length) return afterLine(source, packages.at(-1)!.end);
  const clean = sourceWithoutComments(source);
  const documentClass = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]+\}/.exec(clean);
  return documentClass ? afterLine(source, documentClass.index + documentClass[0].length) : 0;
}

/** Build one preamble edit that satisfies generated-table package requirements without duplicates or xcolor option clashes. */
export function createLatexPreambleInsertion(source: string, requiredCommands: string[]): LatexPreambleInsertion | undefined {
  if (!requiredCommands.length) return undefined;
  const packages = declarations(source);
  const loaded = (name: string) => packages.find((entry) => entry.names.includes(name));
  const commands: string[] = [];
  const addedPackages: string[] = [];
  let offset = defaultInsertionOffset(source, packages);

  for (const requiredCommand of requiredCommands) {
    const required = declarations(`${requiredCommand}\n\\begin{document}`)[0];
    if (!required) continue;
    for (const name of required.names) {
      if (name === "xcolor" && required.options.includes("table")) {
        const xcolor = loaded("xcolor");
        const colortbl = loaded("colortbl");
        if (xcolor && (xcolor.options.includes("table") || colortbl)) continue;
        if (xcolor) {
          commands.push("\\usepackage{colortbl}");
          addedPackages.push("colortbl");
        } else if (colortbl) {
          commands.push("\\usepackage{xcolor}");
          addedPackages.push("xcolor");
          offset = beforeLine(source, colortbl.start);
        } else {
          commands.push("\\usepackage[table]{xcolor}");
          addedPackages.push("xcolor");
        }
      } else if (!loaded(name) && !addedPackages.includes(name)) {
        commands.push(required.names.length === 1 ? requiredCommand : `\\usepackage{${name}}`);
        addedPackages.push(name);
      }
    }
  }

  if (!commands.length) return undefined;
  const leadingNewline = offset > 0 && source[offset - 1] !== "\n" ? "\n" : "";
  return { offset, text: `${leadingNewline}${commands.join("\n")}\n`, addedPackages };
}
