import { Command } from "commander";
import { APIClient } from "../api-client";

interface SearchResult {
  filePath: string;
  lineEnd: number;
  lineStart: number;
  relevance: number;
  snippet: string;
}

export const searchCommand = new Command("search")
  .description("Semantic code search using natural language")
  .argument("<query>", "Natural language search query")
  .option("-p, --project <id>", "Project ID")
  .option("-n, --max-results <count>", "Maximum results to show", "10")
  .action(
    async (query: string, opts: { project?: string; maxResults: string }) => {
      const client = new APIClient();
      const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;
      const maxResults = Number.parseInt(opts.maxResults, 10);

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      try {
        console.log(`Searching: "${query}"\n`);

        const result = await client.submitTask({
          title: `Code search: ${query}`,
          description: `Search codebase for: ${query}. Return top ${maxResults} results.`,
          projectId,
          mode: "ask",
        });

        const results: SearchResult[] = [];

        const stream = client.streamSession(result.sessionId, (event) => {
          switch (event.type) {
            case "search_result": {
              const searchResult = event.data as SearchResult;
              results.push(searchResult);
              break;
            }
            case "token": {
              process.stdout.write(
                String((event.data as { content: string }).content)
              );
              break;
            }
            case "complete": {
              if (results.length > 0) {
                console.log("\n\n--- Search Results ---\n");

                const sorted = [...results]
                  .sort((a, b) => b.relevance - a.relevance)
                  .slice(0, maxResults);

                for (const [index, r] of sorted.entries()) {
                  const lineRange =
                    r.lineStart === r.lineEnd
                      ? `L${r.lineStart}`
                      : `L${r.lineStart}-${r.lineEnd}`;
                  console.log(
                    `${index + 1}. ${r.filePath}:${lineRange} (${Math.round(r.relevance * 100)}% match)`
                  );
                  const lines = r.snippet.split("\n").slice(0, 5);
                  for (const line of lines) {
                    console.log(`   ${line}`);
                  }
                  console.log();
                }
              } else {
                console.log("\n\nNo results found.");
              }

              stream.close();
              process.exit(0);
              break;
            }
            default:
              break;
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );
