import { useCallback, useEffect, useState } from 'react';

const KEY = 'umwelt.activePersonaId';
const CHANGE_EVENT = 'umwelt:active-persona-changed';

export function useActivePersona() {
  const [activePersonaId, setActivePersonaIdState] = useState(() => localStorage.getItem(KEY));

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

  return [activePersonaId, setActivePersonaId];
}
