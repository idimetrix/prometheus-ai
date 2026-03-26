/**
 * Directed dependency graph for workspace packages.
 *
 * Builds a graph from workspace packages and supports queries
 * for dependencies, dependents, affected packages, and
 * topological ordering (build order).
 */

import type { WorkspacePackage } from "./workspace-detector";

interface GraphNode {
  dependencies: Set<string>;
  dependents: Set<string>;
  name: string;
  path: string;
}

export class PackageGraph {
  private readonly nodes: Map<string, GraphNode> = new Map();
  private readonly pathToPackage: Map<string, string> = new Map();

  constructor(packages: WorkspacePackage[]) {
    this.build(packages);
  }

  private build(packages: WorkspacePackage[]): void {
    const packageNames = new Set(packages.map((p) => p.name));

    // Create nodes
    for (const pkg of packages) {
      this.nodes.set(pkg.name, {
        name: pkg.name,
        path: pkg.path,
        dependencies: new Set(),
        dependents: new Set(),
      });
      this.pathToPackage.set(pkg.path, pkg.name);
    }

    // Add edges (only for workspace-internal dependencies)
    for (const pkg of packages) {
      const node = this.nodes.get(pkg.name);
      if (!node) {
        continue;
      }

      for (const dep of pkg.dependencies) {
        if (packageNames.has(dep)) {
          node.dependencies.add(dep);
          const depNode = this.nodes.get(dep);
          if (depNode) {
            depNode.dependents.add(pkg.name);
          }
        }
      }
    }
  }

  /**
   * Get direct dependencies of a package.
   */
  getDependencies(packageName: string): string[] {
    const node = this.nodes.get(packageName);
    if (!node) {
      return [];
    }
    return [...node.dependencies];
  }

  /**
   * Get all transitive dependencies of a package (deep).
   */
  getTransitiveDependencies(packageName: string): string[] {
    const visited = new Set<string>();
    const queue = [packageName];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const node = this.nodes.get(current);
      if (!node) {
        continue;
      }

      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    return [...visited];
  }

  /**
   * Get packages that directly depend on this one.
   */
  getDependents(packageName: string): string[] {
    const node = this.nodes.get(packageName);
    if (!node) {
      return [];
    }
    return [...node.dependents];
  }

  /**
   * Get all packages transitively affected by this one (dependents + their dependents).
   */
  getTransitiveDependents(packageName: string): string[] {
    const visited = new Set<string>();
    const queue = [packageName];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const node = this.nodes.get(current);
      if (!node) {
        continue;
      }

      for (const dep of node.dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    return [...visited];
  }

  /**
   * Given a set of changed file paths, determine which packages are affected.
   * A package is affected if any of the changed files are within its path,
   * or if it transitively depends on an affected package.
   */
  getAffectedPackages(changedFiles: string[]): string[] {
    const directlyAffected = new Set<string>();

    // Find directly affected packages
    for (const file of changedFiles) {
      for (const [path, pkgName] of this.pathToPackage) {
        if (file.startsWith(path) || file.startsWith(`${path}/`)) {
          directlyAffected.add(pkgName);
        }
      }
    }

    // Expand to transitive dependents
    const allAffected = new Set<string>(directlyAffected);
    for (const pkg of directlyAffected) {
      for (const dependent of this.getTransitiveDependents(pkg)) {
        allAffected.add(dependent);
      }
    }

    return [...allAffected];
  }

  /**
   * Return packages in topological order (build order).
   * Packages with no dependencies come first.
   */
  getTopologicalOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) {
        return;
      }
      if (visiting.has(name)) {
        // Cycle detected - just skip
        return;
      }

      visiting.add(name);
      const node = this.nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of this.nodes.keys()) {
      visit(name);
    }

    return result;
  }

  /**
   * Get all package names in the graph.
   */
  getPackageNames(): string[] {
    return [...this.nodes.keys()];
  }

  /**
   * Get the path for a package.
   */
  getPackagePath(packageName: string): string | undefined {
    return this.nodes.get(packageName)?.path;
  }
}
