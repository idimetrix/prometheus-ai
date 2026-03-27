import { createLogger } from "@prometheus/logger";

const _logger = createLogger("orchestrator:component-library-registry");

export interface ComponentInfo {
  category: string;
  examples: string[];
  importPath: string;
  name: string;
  props: Array<{
    name: string;
    type: string;
    required: boolean;
    default?: string;
    description: string;
  }>;
}

export interface LibraryConfig {
  components: ComponentInfo[];
  docsUrl: string;
  installCommand: string;
  name: string;
  packageName: string;
  version?: string;
}

const LIBRARY_REGISTRY: Record<string, LibraryConfig> = {
  "shadcn/ui": {
    name: "shadcn/ui",
    packageName: "shadcn-ui",
    installCommand: "npx shadcn@latest add",
    docsUrl: "https://ui.shadcn.com",
    components: [
      {
        name: "Button",
        category: "inputs",
        importPath: "@/components/ui/button",
        props: [
          {
            name: "variant",
            type: '"default" | "destructive" | "outline" | "secondary" | "ghost" | "link"',
            required: false,
            default: '"default"',
            description: "Visual style variant",
          },
          {
            name: "size",
            type: '"default" | "sm" | "lg" | "icon"',
            required: false,
            default: '"default"',
            description: "Button size",
          },
          {
            name: "asChild",
            type: "boolean",
            required: false,
            default: "false",
            description: "Render as child element",
          },
        ],
        examples: [
          '<Button variant="default">Click me</Button>',
          '<Button variant="outline" size="sm">Small</Button>',
        ],
      },
      {
        name: "Card",
        category: "layout",
        importPath: "@/components/ui/card",
        props: [],
        examples: [
          "<Card><CardHeader><CardTitle>Title</CardTitle></CardHeader><CardContent>Content</CardContent></Card>",
        ],
      },
      {
        name: "Dialog",
        category: "overlay",
        importPath: "@/components/ui/dialog",
        props: [
          {
            name: "open",
            type: "boolean",
            required: false,
            description: "Controlled open state",
          },
          {
            name: "onOpenChange",
            type: "(open: boolean) => void",
            required: false,
            description: "Open state change handler",
          },
        ],
        examples: [
          "<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Title</DialogTitle></DialogHeader></DialogContent></Dialog>",
        ],
      },
      {
        name: "Input",
        category: "inputs",
        importPath: "@/components/ui/input",
        props: [
          {
            name: "type",
            type: "string",
            required: false,
            default: '"text"',
            description: "Input type",
          },
          {
            name: "placeholder",
            type: "string",
            required: false,
            description: "Placeholder text",
          },
        ],
        examples: ['<Input type="email" placeholder="Email" />'],
      },
      {
        name: "Select",
        category: "inputs",
        importPath: "@/components/ui/select",
        props: [],
        examples: [
          '<Select><SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectItem value="a">A</SelectItem></SelectContent></Select>',
        ],
      },
      {
        name: "Table",
        category: "data-display",
        importPath: "@/components/ui/table",
        props: [],
        examples: [
          "<Table><TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Value</TableCell></TableRow></TableBody></Table>",
        ],
      },
      {
        name: "Tabs",
        category: "navigation",
        importPath: "@/components/ui/tabs",
        props: [
          {
            name: "defaultValue",
            type: "string",
            required: false,
            description: "Default active tab",
          },
        ],
        examples: [
          '<Tabs defaultValue="tab1"><TabsList><TabsTrigger value="tab1">Tab 1</TabsTrigger></TabsList><TabsContent value="tab1">Content</TabsContent></Tabs>',
        ],
      },
    ],
  },
  mui: {
    name: "Material UI",
    packageName: "@mui/material",
    installCommand: "npm install @mui/material @emotion/react @emotion/styled",
    docsUrl: "https://mui.com",
    components: [
      {
        name: "Button",
        category: "inputs",
        importPath: "@mui/material/Button",
        props: [
          {
            name: "variant",
            type: '"text" | "contained" | "outlined"',
            required: false,
            default: '"text"',
            description: "Button variant",
          },
        ],
        examples: ['<Button variant="contained">Click</Button>'],
      },
      {
        name: "TextField",
        category: "inputs",
        importPath: "@mui/material/TextField",
        props: [
          {
            name: "label",
            type: "string",
            required: false,
            description: "Label text",
          },
          {
            name: "variant",
            type: '"outlined" | "filled" | "standard"',
            required: false,
            default: '"outlined"',
            description: "Style variant",
          },
        ],
        examples: ['<TextField label="Name" variant="outlined" />'],
      },
      {
        name: "Card",
        category: "layout",
        importPath: "@mui/material/Card",
        props: [],
        examples: [
          "<Card><CardContent><Typography>Content</Typography></CardContent></Card>",
        ],
      },
    ],
  },
  chakra: {
    name: "Chakra UI",
    packageName: "@chakra-ui/react",
    installCommand:
      "npm install @chakra-ui/react @emotion/react @emotion/styled framer-motion",
    docsUrl: "https://chakra-ui.com",
    components: [
      {
        name: "Button",
        category: "inputs",
        importPath: "@chakra-ui/react",
        props: [
          {
            name: "colorScheme",
            type: "string",
            required: false,
            default: '"gray"',
            description: "Color scheme",
          },
          {
            name: "size",
            type: '"xs" | "sm" | "md" | "lg"',
            required: false,
            default: '"md"',
            description: "Size variant",
          },
        ],
        examples: ['<Button colorScheme="blue">Click</Button>'],
      },
      {
        name: "Input",
        category: "inputs",
        importPath: "@chakra-ui/react",
        props: [
          {
            name: "placeholder",
            type: "string",
            required: false,
            description: "Placeholder",
          },
        ],
        examples: ['<Input placeholder="Enter text" />'],
      },
    ],
  },
};

/**
 * Detect which component library a project uses from its package.json dependencies.
 */
export function detectComponentLibrary(
  dependencies: Record<string, string>
): string | null {
  if (
    dependencies["@radix-ui/react-slot"] ||
    dependencies["class-variance-authority"]
  ) {
    return "shadcn/ui";
  }
  if (dependencies["@mui/material"]) {
    return "mui";
  }
  if (dependencies["@chakra-ui/react"]) {
    return "chakra";
  }
  if (dependencies["@mantine/core"]) {
    return "mantine";
  }
  if (dependencies.antd) {
    return "antd";
  }
  return null;
}

/**
 * Get the component library configuration for use in code generation prompts.
 */
export function getLibraryConfig(libraryName: string): LibraryConfig | null {
  return LIBRARY_REGISTRY[libraryName] ?? null;
}

/**
 * Generate a prompt context section describing available components.
 */
export function generateLibraryContext(libraryName: string): string {
  const config = LIBRARY_REGISTRY[libraryName];
  if (!config) {
    return "";
  }

  const lines = [
    `## Available Components from ${config.name}`,
    `Package: ${config.packageName}`,
    `Docs: ${config.docsUrl}`,
    "",
  ];

  for (const comp of config.components) {
    lines.push(`### ${comp.name} (${comp.category})`);
    lines.push(`Import: \`import { ${comp.name} } from "${comp.importPath}"\``);
    if (comp.props.length > 0) {
      lines.push("Props:");
      for (const prop of comp.props) {
        lines.push(
          `  - ${prop.name}: ${prop.type}${prop.required ? " (required)" : ""}${prop.default ? ` = ${prop.default}` : ""}`
        );
      }
    }
    if (comp.examples.length > 0) {
      lines.push(`Example: \`${comp.examples[0]}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get all registered library names.
 */
export function getRegisteredLibraries(): string[] {
  return Object.keys(LIBRARY_REGISTRY);
}
