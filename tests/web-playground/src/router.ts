import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { modules } from './modules/registry'

const moduleRoutes: RouteRecordRaw[] = modules.flatMap((module): RouteRecordRaw[] =>
  module.routes?.length
    ? module.routes
    : [
        {
          path: `/${module.id}`,
          name: module.id,
          component: module.view,
          meta: { moduleId: module.id },
        },
      ],
)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...moduleRoutes,
    { path: '/', redirect: `/${modules[0].id}` },
    { path: '/:pathMatch(.*)*', redirect: `/${modules[0].id}` },
  ],
})
