// Every scenario the stage can play, by the name the renderer and the GIFs use.
import { roadmap } from "./roadmap.js";
import { leadsScheduled, leadsAccurate } from "./leads.js";

export const SCENARIOS = {
  roadmap,
  "leads-scheduled": leadsScheduled,
  "leads-accurate": leadsAccurate,
};
