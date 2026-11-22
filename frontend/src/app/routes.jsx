/**
 * Application routes — defines the page-level routing for TERRAXX.
 * Uses react-router-dom v6 to map URLs to page components.
 */

import { lazy, Suspense } from 'react';
import { createRoutesFromElements, Route, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Providers } from './providers.jsx';

const Home = lazy(() => import('../pages/Home.jsx'));
const Dashboard = lazy(() => import('../pages/Dashboard.jsx'));
const Analysis = lazy(() => import('../pages/Analysis.jsx'));
const Explore = lazy(() => import('../pages/Explore.jsx'));
const History = lazy(() => import('../pages/History.jsx'));
const NdviMonitoring = lazy(() => import('../pages/NdviMonitoring.jsx'));
const Compare = lazy(() => import('../pages/Compare.jsx'));
const Reports = lazy(() => import('../pages/Reports.jsx'));
const About = lazy(() => import('../pages/About.jsx'));
const NotFound = lazy(() => import('../pages/NotFound.jsx'));

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Home />,
    },
    {
      path: '/dashboard',
      element: <Dashboard />,
    },
    {
      path: '/analysis',
      element: <Analysis />,
    },
    {
      path: '/explore',
      element: <Explore />,
    },
    {
      path: '/history',
      element: <History />,
    },
    {
      path: '/ndvi',
      element: <NdviMonitoring />,
    },
    {
      path: '/compare',
      element: <Compare />,
    },
    {
      path: '/reports',
      element: <Reports />,
    },
    {
      path: '/about',
      element: <About />,
    },
    {
      path: '*',
      element: <NotFound />,
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);

/**
 * Renders the application routes wrapped in providers.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export const AppRoutes = ({ children }) => (
  <Providers>
    <Suspense fallback={<div className="route-fallback">Loading…</div>}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Suspense>
    {children}
  </Providers>
);

export default AppRoutes;