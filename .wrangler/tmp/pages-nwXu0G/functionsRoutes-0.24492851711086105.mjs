import { onRequest as __api_figures__id__ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\figures\\[id].ts"
import { onRequest as __api_games__id__ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\games\\[id].ts"
import { onRequest as __api_platforms__id__ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\platforms\\[id].ts"
import { onRequest as __api_figures_ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\figures.ts"
import { onRequest as __api_games_ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\games.ts"
import { onRequest as __api_platforms_ts_onRequest } from "C:\\Users\\wesdi\\.gemini\\antigravity\\scratch\\collection-tracker\\functions\\api\\platforms.ts"

export const routes = [
    {
      routePath: "/api/figures/:id",
      mountPath: "/api/figures",
      method: "",
      middlewares: [],
      modules: [__api_figures__id__ts_onRequest],
    },
  {
      routePath: "/api/games/:id",
      mountPath: "/api/games",
      method: "",
      middlewares: [],
      modules: [__api_games__id__ts_onRequest],
    },
  {
      routePath: "/api/platforms/:id",
      mountPath: "/api/platforms",
      method: "",
      middlewares: [],
      modules: [__api_platforms__id__ts_onRequest],
    },
  {
      routePath: "/api/figures",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_figures_ts_onRequest],
    },
  {
      routePath: "/api/games",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_games_ts_onRequest],
    },
  {
      routePath: "/api/platforms",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_platforms_ts_onRequest],
    },
  ]