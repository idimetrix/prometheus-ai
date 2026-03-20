/**
 * Phase 5.2: Type Hierarchy Graph.
 *
 * Tracks inheritance and interface implementation relationships
 * between types, enabling queries for parents, children, and implementors.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:type-hierarchy");

/** A type reference with its declaring file. */
export interface TypeRef {
  file: string;
  typeName: string;
}

/** Relationship kind between types. */
export type TypeRelation = "extends" | "implements";

interface TypeEdge {
  childType: string;
  file: string;
  parentType: string;
  relation: TypeRelation;
}

/**
 * Builds and queries a type hierarchy graph tracking extends/implements
 * relationships between types.
 */
export class TypeHierarchyBuilder {
  /** Parent -> children mapping */
  private readonly children = new Map<string, Set<string>>();

  /** Child -> parents mapping */
  private readonly parents = new Map<string, Set<string>>();

  /** Interface -> implementors mapping */
  private readonly implementors = new Map<string, Set<string>>();

  /** Type -> implementing interfaces mapping */
  private readonly implementedBy = new Map<string, Set<string>>();

  /** All recorded edges for metadata */
  private readonly edges: TypeEdge[] = [];

  /** Type name -> file mapping */
  private readonly typeFiles = new Map<string, string>();

  /**
   * Record an inheritance relationship (extends).
   */
  addInheritance(childType: string, parentType: string, file: string): void {
    this.typeFiles.set(childType, file);

    if (!this.children.has(parentType)) {
      this.children.set(parentType, new Set());
    }
    this.children.get(parentType)?.add(childType);

    if (!this.parents.has(childType)) {
      this.parents.set(childType, new Set());
    }
    this.parents.get(childType)?.add(parentType);

    this.edges.push({
      childType,
      parentType,
      file,
      relation: "extends",
    });

    logger.debug(
      { childType, parentType, file },
      "Inheritance relationship added"
    );
  }

  /**
   * Record an interface implementation relationship.
   */
  addImplementation(
    typeName: string,
    interfaceType: string,
    file: string
  ): void {
    this.typeFiles.set(typeName, file);

    if (!this.implementors.has(interfaceType)) {
      this.implementors.set(interfaceType, new Set());
    }
    this.implementors.get(interfaceType)?.add(typeName);

    if (!this.implementedBy.has(typeName)) {
      this.implementedBy.set(typeName, new Set());
    }
    this.implementedBy.get(typeName)?.add(interfaceType);

    this.edges.push({
      childType: typeName,
      parentType: interfaceType,
      file,
      relation: "implements",
    });

    logger.debug(
      { typeName, interfaceType, file },
      "Implementation relationship added"
    );
  }

  /**
   * Get all parent types of a given type (via extends).
   */
  getParents(typeName: string): TypeRef[] {
    const parentNames = this.parents.get(typeName);
    if (!parentNames) {
      return [];
    }

    return this.resolveTypeRefs(parentNames);
  }

  /**
   * Get all child types of a given type (via extends).
   */
  getChildren(typeName: string): TypeRef[] {
    const childNames = this.children.get(typeName);
    if (!childNames) {
      return [];
    }

    return this.resolveTypeRefs(childNames);
  }

  /**
   * Get all types that implement a given interface.
   */
  getImplementors(interfaceName: string): TypeRef[] {
    const implNames = this.implementors.get(interfaceName);
    if (!implNames) {
      return [];
    }

    return this.resolveTypeRefs(implNames);
  }

  /**
   * Get all interfaces implemented by a given type.
   */
  getInterfaces(typeName: string): TypeRef[] {
    const ifaceNames = this.implementedBy.get(typeName);
    if (!ifaceNames) {
      return [];
    }

    return this.resolveTypeRefs(ifaceNames);
  }

  /**
   * Get all recorded edges.
   */
  getAllEdges(): TypeEdge[] {
    return [...this.edges];
  }

  /**
   * Resolve a set of type names to TypeRef objects.
   */
  private resolveTypeRefs(names: Set<string>): TypeRef[] {
    const results: TypeRef[] = [];
    for (const name of names) {
      results.push({
        typeName: name,
        file: this.typeFiles.get(name) ?? "unknown",
      });
    }
    return results;
  }
}
