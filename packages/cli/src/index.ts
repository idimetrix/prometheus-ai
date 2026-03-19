#!/usr/bin/env node

import { Command } from "commander";
import { chatCommand } from "./commands/chat";
import { statusCommand } from "./commands/status";
import { taskCommand } from "./commands/task";

const program = new Command();

program
  .name("prometheus")
  .description("Prometheus AI Engineering Platform CLI")
  .version("0.1.0");

program.addCommand(taskCommand);
program.addCommand(chatCommand);
program.addCommand(statusCommand);

program.parse();
