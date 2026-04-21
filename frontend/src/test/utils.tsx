import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { SettingsProvider } from '../contexts/SettingsContext';
import { SourceFilterProvider } from '../contexts/SourceFilterContext';
import { KeyboardNavigationProvider } from '../contexts/KeyboardNavigationContext';

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });
}

interface WrapperProps {
  children: React.ReactNode;
}

// Provider wrapper for tests
function AllProviders({ children }: WrapperProps) {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <SourceFilterProvider>
          <BrowserRouter>
            <KeyboardNavigationProvider>
              {children}
            </KeyboardNavigationProvider>
          </BrowserRouter>
        </SourceFilterProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

// Custom render function that includes providers
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from RTL
export * from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';

// Override render with custom render
export { customRender as render };
