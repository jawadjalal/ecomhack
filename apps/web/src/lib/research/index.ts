/**
 * Research module public API. OWNED BY: research.
 * Market & competitor research with Tavily (TAVILY_API_KEY) + LLM summary; labelled sample without a key.
 */
export {
  researchCompetitors,
  askResearch,
  DEFAULT_STORE,
  type ResearchInput,
  type AskInput,
} from "./research";
export { listReports, getReport, takeResearchToken, clientOf } from "./store";
export { tavilyAvailable } from "./tavily";
