#!/usr/bin/env node

import { Command } from "commander";
import { chatCommand } from "./commands/chat";
import { fleetCommand } from "./commands/fleet";
import { initCommand } from "./commands/init";
import { planCommand } from "./commands/plan";
import { reviewCommand } from "./commands/review";
import { searchCommand } from "./commands/search";
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
program.addCommand(planCommand);
program.addCommand(fleetCommand);
program.addCommand(reviewCommand);
program.addCommand(searchCommand);
program.addCommand(initCommand);

program.parse();
