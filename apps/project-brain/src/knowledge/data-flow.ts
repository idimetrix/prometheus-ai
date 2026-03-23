/**
 * Phase 5.3: Data Flow Analysis.
 *
 * Tracks parameter origins and return value consumers across functions,
 * enabling data provenance queries (where does this data come from,
 * where does it go).
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:data-flow");

/** Describes a tracked parameter of a function. */
export interface ParameterFlow {
  functionName: string;
  paramName: string;
  sourceFile: string;
}

/** Describes a tracked return value of a function. */
export interface ReturnFlow {
  functionName: string;
  returnType: string;
  sourceFile: string;
}

/** Describes a consumer of a function's return value. */
export interface DataConsumer {
  consumerFile: string;
  consumerFunction: string;
}

function paramKey(functionName: string, paramName: string): string {
  return `${functionName}#${paramName}`;
}

/**
 * Tracks data flow through function parameters and return values.
 *
 * Enables queries like:
 * - "Where does this parameter's data originate?"
 * - "Which functions consume the return value of this function?"
 */
export class DataFlowAnalyzer {
  /** Parameter tracking: paramKey -> array of source flows */
  private readonly parameterSources = new Map<string, ParameterFlow[]>();

  /** Return tracking: functionName -> return flow info */
  private readonly returnFlows = new Map<string, ReturnFlow>();

  /** Consumer tracking: functionName -> list of consumers */
  private readonly consumers = new Map<string, DataConsumer[]>();

  /**
   * Track a parameter's data origin.
   */
  trackParameter(
    functionName: string,
    paramName: string,
    sourceFile: string
  ): void {
    const key = paramKey(functionName, paramName);

    if (!this.parameterSources.has(key)) {
      this.parameterSources.set(key, []);
    }

    this.parameterSources.get(key)?.push({
      functionName,
      paramName,
      sourceFile,
    });

    logger.debug(
      { functionName, paramName, sourceFile },
      "Parameter source tracked"
    );
  }

  /**
   * Track a function's return value type and source file.
   */
  trackReturn(
    functionName: string,
    returnType: string,
    sourceFile: string
  ): void {
    this.returnFlows.set(functionName, {
      functionName,
      returnType,
      sourceFile,
    });

    logger.debug(
      { functionName, returnType, sourceFile },
      "Return flow tracked"
    );
  }

  /**
   * Register a consumer of a function's return value.
   */
  addConsumer(
    producerFunction: string,
    consumerFunction: string,
    consumerFile: string
  ): void {
    if (!this.consumers.has(producerFunction)) {
      this.consumers.set(producerFunction, []);
    }

    this.consumers.get(producerFunction)?.push({
      consumerFunction,
      consumerFile,
    });

    logger.debug(
      { producerFunction, consumerFunction, consumerFile },
      "Data consumer registered"
    );
  }

  /**
   * Trace where a function parameter's data comes from.
   */
  getDataSources(functionName: string, paramName: string): ParameterFlow[] {
    const key = paramKey(functionName, paramName);
    return this.parameterSources.get(key) ?? [];
  }

  /**
   * Trace where a function's return value is consumed.
   */
  getDataConsumers(functionName: string): DataConsumer[] {
    return this.consumers.get(functionName) ?? [];
  }

  /**
   * Get the return flow information for a function.
   */
  getReturnFlow(functionName: string): ReturnFlow | undefined {
    return this.returnFlows.get(functionName);
  }

  /**
   * Get all tracked functions.
   */
  getTrackedFunctions(): string[] {
    const functions = new Set<string>();

    for (const flow of this.returnFlows.values()) {
      functions.add(flow.functionName);
    }

    for (const flows of this.parameterSources.values()) {
      for (const flow of flows) {
        functions.add(flow.functionName);
      }
    }

    return [...functions];
  }
}
