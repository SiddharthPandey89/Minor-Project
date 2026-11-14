/**
 * Application providers â€” wraps the app with the store provider and
 * any other global context (e.g. theme, language).
 */

import React from 'react';
import { AppProvider } from './store.jsx';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export const Providers = ({ children }) => {
  return <AppProvider>{children}</AppProvider>;
};

export default Providers;
