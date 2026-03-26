#!/usr/bin/env node

import { Command } from "commander";
import { benchmarkCommand } from "./commands/benchmark";
import { chatCommand } from "./commands/chat";
import { deployCommand } from "./commands/deploy";
import { envCommand } from "./commands/env";
import { fleetCommand } from "./commands/fleet";
import { initCommand } from "./commands/init";
import { logsCommand } from "./commands/logs";
import { planCommand } from "./commands/plan";
import { prCommand } from "./commands/pr";
import { reviewCommand } from "./commands/review";
import { searchCommand } from "./commands/search";
import { sessionsCommand } from "./commands/sessions";
import { statusCommand } from "./commands/status";
import { taskCommand } from "./commands/task";
import { watchCommand } from "./commands/watch";

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
program.addCommand(sessionsCommand);
program.addCommand(initCommand);
program.addCommand(benchmarkCommand);
program.addCommand(deployCommand);
program.addCommand(envCommand);
program.addCommand(logsCommand);
program.addCommand(prCommand);
program.addCommand(watchCommand);

program.parse();
