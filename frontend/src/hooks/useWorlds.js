import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

const CURRENT_WORLD_KEY = 'umwelt.currentWorldId';

export function useWorlds() {
  return useQuery({ queryKey: ['worlds'], queryFn: () => api.get('/api/worlds') });
}

/** The worldId from the current route if present, else the first known world. */
export function useCurrentWorldId() {
  const { pathname } = useLocation();
  const { data } = useWorlds();
  const routeWorldId = /^\/worlds\/([^/]+)/.exec(pathname)?.[1];
  const [rememberedWorldId, setRememberedWorldId] = useState(() => localStorage.getItem(CURRENT_WORLD_KEY));

  useEffect(() => {
    if (!routeWorldId) return;
    localStorage.setItem(CURRENT_WORLD_KEY, routeWorldId);
    setRememberedWorldId(routeWorldId);
  }, [routeWorldId]);

  const available = data?.worlds ?? [];
  if (routeWorldId) return routeWorldId;
  if (rememberedWorldId && available.includes(rememberedWorldId)) return rememberedWorldId;
  return available[0] ?? null;
}
