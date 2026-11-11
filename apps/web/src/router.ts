import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from './layouts/AppLayout.vue'
import { useAuth } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', redirect: '/pgp' },
        { path: 'pgp', name: 'pgp', component: () => import('./views/pgp/PgpHomeView.vue'), meta: { title: 'Personal Growth Plan' } },
        { path: 'pgp/new', name: 'plan-new', component: () => import('./views/pgp/NewPlanView.vue'), meta: { title: 'Create PGP' } },
        { path: 'pgp/plans/:id', name: 'plan', component: () => import('./views/pgp/PlanEditorView.vue'), props: true, meta: { title: 'Personal Growth Plan' } },
        { path: 'pgp/templates', name: 'templates', component: () => import('./views/pgp/TemplatesView.vue'), meta: { title: 'PGP Templates', admin: true } },
        { path: 'pgp/templates/new', name: 'template-new', component: () => import('./views/pgp/TemplateEditorView.vue'), meta: { title: 'New Template', admin: true } },
        { path: 'pgp/templates/:id', name: 'template', component: () => import('./views/pgp/TemplateEditorView.vue'), props: true, meta: { title: 'Edit Template', admin: true } },
        { path: 'admin/sla', name: 'sla-goals', component: () => import('./views/admin/SlaGoalsView.vue'), meta: { title: 'SLA goals', admin: true } },
        { path: 'kanban', name: 'kanban', component: () => import('./views/kanban/KanbanView.vue'), meta: { title: 'My Kanban' } },
        { path: 'pull-requests', name: 'pull-requests', component: () => import('./views/pull-requests/PullRequestsView.vue'), meta: { title: 'My Pull Requests' } },
        { path: 'pull-requests/:repo/:id', name: 'pull-request', component: () => import('./views/pull-requests/PullRequestDetailView.vue'), props: true, meta: { title: 'Pull Request' } },
        { path: 'team', name: 'team', component: () => import('./views/team/TeamView.vue'), meta: { title: 'Tim Saya' } },
        { path: 'confluence', name: 'confluence', component: () => import('./views/confluence/ConfluenceView.vue'), meta: { title: 'My Confluence' } },
        { path: 'connections', name: 'connections', component: () => import('./views/ConnectionsView.vue'), meta: { title: 'Connections' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  if (!auth.loaded) await auth.load()
  if (to.meta.public) return auth.me && to.name === 'login' ? '/' : true
  if (!auth.me) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.admin && auth.me.role !== 'admin') return '/pgp'
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · One Desk` : 'One Desk'
})
