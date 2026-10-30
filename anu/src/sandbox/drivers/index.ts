import type { DriverName } from "../../config.js";
import { harnessDriver } from "./harness.js";
import { kiloDriver } from "./kilo.js";
import { scriptedDriver } from "./scripted.js";
import type { Driver } from "./types.js";

export const DRIVERS: Record<DriverName, Driver> = {
  scripted: scriptedDriver,
  kilo: kiloDriver,
  harness: harnessDriver,
};
