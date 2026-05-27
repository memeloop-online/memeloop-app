import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

export function useInitialPage() {
  const [location, setLocation] = useLocation();
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Only initialize once and only when at root
    if (!hasInitialized.current && (location === '/' || location === '')) {
      hasInitialized.current = true;
      // Default to agent page
      setLocation('/agent');
    }
  }, [location, setLocation]);
}
