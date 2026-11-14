/**
 * Application store — centralised state container.
 * Uses React context + useReducer to provide a predictable state
 * management layer without introducing Redux complexity.
 */

import { createContext, useContext, useReducer } from 'react';

const initialState = {
  user: null,
  selectedRegion: null,
  analysis: null,
  habitability: null,
  ui: {
    sidebarOpen: true,
    language: 'en',
    theme: 'dark',
  },
};

const AppContext = createContext(null);

const reducer = (state, action) => {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'SET_SELECTED_REGION':
      return { ...state, selectedRegion: action.payload };
    case 'SET_ANALYSIS':
      return { ...state, analysis: action.payload };
    case 'SET_HABITABILITY':
      return { ...state, habitability: action.payload };
    case 'SET_UI':
      return { ...state, ui: { ...state.ui, ...action.payload } };
    case 'RESET_ANALYSIS':
      return { ...state, analysis: null, habitability: null };
    default:
      return state;
  }
};

export const AppProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
};

export const useAppStore = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppStore must be used within an AppProvider');
  }
  return context;
};

export const selectors = {
  user: (state) => state.user,
  selectedRegion: (state) => state.selectedRegion,
  analysis: (state) => state.analysis,
  habitability: (state) => state.habitability,
  ui: (state) => state.ui,
};

export default AppContext;