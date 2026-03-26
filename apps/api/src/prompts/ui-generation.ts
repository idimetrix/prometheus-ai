/**
 * UI Generation Prompts
 *
 * Specialized prompts for fast-path UI generation that bypasses the full
 * orchestrator pipeline. Designed for <15 second generation of React components.
 */

export const UI_GENERATION_SYSTEM_PROMPT = `You are an expert React UI developer. You generate production-quality React components using TypeScript, Tailwind CSS, and shadcn/ui.

Rules:
- Output ONLY the component code. No explanations, no markdown fences, no comments outside the code.
- Generate a single React component file.
- Use TypeScript with explicit prop types.
- Use Tailwind CSS utility classes for all styling (no inline styles, no CSS modules).
- Use shadcn/ui components where appropriate: Button, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Input, Label, Badge, Avatar, Separator, Tabs, TabsList, TabsTrigger, TabsContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Dialog, Sheet, Tooltip.
- Import shadcn/ui components from their individual paths (e.g., "@/components/ui/button").
- Use Lucide React icons (import from "lucide-react").
- Make the layout responsive using Tailwind breakpoints (sm:, md:, lg:).
- Include dark mode support using Tailwind dark: classes.
- Use semantic HTML elements.
- Include aria-label attributes on interactive elements.
- Export the component as a named export.
- Include a Props interface.
- Use "use client" directive at the top.
- Use React hooks (useState, useEffect, etc.) when interactivity is needed.
- Generate realistic placeholder data (not "Lorem ipsum").`;

export function buildUIGenerationPrompt(
  prompt: string,
  style: "shadcn" | "tailwind" | "plain",
  framework: "react" | "nextjs"
): string {
  let styleGuide: string;
  if (style === "shadcn") {
    styleGuide =
      "Use shadcn/ui components extensively. Import from @/components/ui/*.";
  } else if (style === "tailwind") {
    styleGuide =
      "Use only Tailwind CSS utility classes. Do not use any component library.";
  } else {
    styleGuide = "Use plain HTML elements with minimal Tailwind styling.";
  }

  const frameworkGuide =
    framework === "nextjs"
      ? 'Add "use client" at the top. Use Next.js Image component for images (import from "next/image"). Use Next.js Link for navigation (import from "next/link").'
      : 'Add "use client" at the top. Use standard React patterns.';

  return `Generate a React component based on this description:

${prompt}

Style: ${styleGuide}
Framework: ${frameworkGuide}

Output ONLY the complete TypeScript component code. No markdown, no explanations.`;
}

export function buildUIRefinementPrompt(
  currentCode: string,
  instruction: string
): string {
  return `Here is the current React component code:

\`\`\`tsx
${currentCode}
\`\`\`

Apply this modification:
${instruction}

Rules:
- Modify the existing code, do NOT rewrite from scratch.
- Preserve the existing structure and imports where possible.
- Only change what is necessary to fulfill the instruction.
- Output ONLY the complete modified TypeScript component code. No markdown fences, no explanations.`;
}
