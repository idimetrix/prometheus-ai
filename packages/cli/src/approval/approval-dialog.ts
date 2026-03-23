import { createInterface } from "node:readline";

/**
 * Interactive terminal approval dialogs for dangerous or file-modifying
 * operations. Prompts the user and returns whether to proceed.
 */
export class ApprovalDialog {
  /**
   * Show a diff and ask the user to approve or reject the change.
   */
  showDiffApproval(filePath: string, diff: string): Promise<boolean> {
    console.log(`\n--- Changes to ${filePath} ---`);
    console.log(diff);
    console.log("---");
    return this.confirm("Apply these changes?");
  }

  /**
   * Show a command and ask the user to approve or reject execution.
   */
  showCommandApproval(command: string): Promise<boolean> {
    console.log(`\n  Command: ${command}`);
    return this.confirm("Execute this command?");
  }

  /**
   * Show a destructive action warning with confirmation.
   */
  showDestructiveWarning(action: string): Promise<boolean> {
    console.log("\n  *** DESTRUCTIVE ACTION ***");
    console.log(`  ${action}`);
    console.log("  This cannot be undone.\n");
    return this.confirm('Type "yes" to confirm');
  }

  /**
   * Simple yes/no prompt returning a boolean.
   */
  private confirm(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(`${prompt} (y/n): `, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      });
    });
  }
}
