import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

const KEY = 'umwelt.activePersonaId';
const CHANGE_EVENT = 'umwelt:active-persona-changed';

export function useActivePersona() {
  const [activePersonaId, setActivePersonaIdState] = useState(() => localStorage.getItem(KEY));
  const personasQuery = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get('/api/personas'),
    staleTime: 30_000,
  });

  const setActivePersonaId = useCallback((id) => {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    setActivePersonaIdState(id);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id ?? null }));
  }, []);

  useEffect(() => {
    const sync = (event) => setActivePersonaIdState(event.detail ?? localStorage.getItem(KEY));
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!activePersonaId || !personasQuery.data) return;
    const exists = personasQuery.data.personas?.some((persona) => persona.id === activePersonaId);
    if (!exists) setActivePersonaId(null);
  }, [activePersonaId, personasQuery.data, setActivePersonaId]);

  return [activePersonaId, setActivePersonaId];
}
