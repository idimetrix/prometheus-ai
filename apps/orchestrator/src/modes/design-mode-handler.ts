import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:design");

const DESIGN_SYSTEM_CONTEXT = `You are a UI component design specialist. You generate production-quality React components using:

**Design System:**
- shadcn/ui components (Button, Card, Dialog, Input, Select, Tabs, etc.)
- Tailwind CSS for styling (utility-first approach)
- Radix UI primitives for accessibility
- Lucide React for icons

**Code Standards:**
- TypeScript with explicit prop types
- Functional components with hooks
- Responsive by default (mobile-first)
- Accessible (ARIA attributes, keyboard navigation, focus management)
- Dark mode support via Tailwind dark: modifier
- Clean, readable code with meaningful variable names

**Output Format:**
- Export a single default component
- Include all necessary imports
- Define prop types with TypeScript interface
- Add JSDoc comment describing the component
- Use 'use client' directive when client-side interactivity is needed

When iterating on a component:
- Preserve the existing structure unless told otherwise
- Apply the user's feedback precisely
- Explain what changed and why`;

/**
 * Design Mode: UI component generation and iteration.
 * Flow: user describes UI -> agent generates component -> sandbox renders -> user iterates
 */
export class DesignModeHandler implements ModeHandler {
  readonly modeName = "design";
  private readonly eventPublisher = new EventPublisher();

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Design mode: generating UI component"
    );

    // Phase 1: Analyze the user's design request
    await this.publishPhase(params.sessionId, "design_analysis", "running");

    const analysisPrompt = `${DESIGN_SYSTEM_CONTEXT}

Analyze the following UI component request and describe the component structure you will build.
Include: layout approach, key shadcn/ui components to use, responsive breakpoints, and accessibility considerations.

User Request:
${params.taskDescription}

Respond with a brief analysis (3-5 bullet points), then generate the full component code.`;

    const analysisResult = await params.agentLoop.executeTask(
      analysisPrompt,
      "frontend_coder"
    );

    await this.publishPhase(params.sessionId, "design_analysis", "completed");

    // Phase 2: Generate the component
    await this.publishPhase(
      params.sessionId,
      "component_generation",
      "running"
    );

    const generatePrompt = `${DESIGN_SYSTEM_CONTEXT}

Based on the analysis, generate the complete React component code for:
${params.taskDescription}

Requirements:
1. The component must be self-contained in a single file
2. Use shadcn/ui components where appropriate
3. Style with Tailwind CSS utility classes
4. Make it responsive (mobile, tablet, desktop)
5. Support dark mode
6. Include TypeScript prop types
7. Add accessibility attributes (aria-labels, roles, keyboard handlers)

Output the complete component code wrapped in a code block.`;

    const generateResult = await params.agentLoop.executeTask(
      generatePrompt,
      "frontend_coder"
    );

    await this.publishPhase(
      params.sessionId,
      "component_generation",
      "completed"
    );

    // Phase 3: Verify the component
    await this.publishPhase(params.sessionId, "design_verification", "running");

    const verifyPrompt = `Review the generated component for:
1. TypeScript correctness (no type errors)
2. All imports are valid (shadcn/ui, Tailwind classes exist)
3. Responsive design works at all breakpoints
4. Accessibility compliance (WCAG 2.1 AA)
5. Dark mode works correctly
6. No hardcoded colors outside of Tailwind palette

If any issues are found, fix them and output the corrected component code.`;

    const verifyResult = await params.agentLoop.executeTask(
      verifyPrompt,
      "frontend_coder"
    );

    await this.publishPhase(
      params.sessionId,
      "design_verification",
      "completed"
    );

    // Publish a component_generated event for the frontend
    await this.eventPublisher.publishSessionEvent(params.sessionId, {
      type: QueueEvents.AGENT_OUTPUT,
      data: {
        phase: "component_ready",
        component: generateResult.output,
        verification: verifyResult.output,
      },
      timestamp: new Date().toISOString(),
    });

    return {
      results: [analysisResult, generateResult, verifyResult],
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
      metadata: {
        mode: "design",
        phases: ["analysis", "generation", "verification"],
      },
    };
  }

  private async publishPhase(
    sessionId: string,
    phase: string,
    status: string
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.PLAN_UPDATE,
      data: { phase, status },
      timestamp: new Date().toISOString(),
    });
  }
}
