import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/**
 * Fetch a GET endpoint, with a `reload` you can call after a mutation.
 * Stale responses are discarded so a fast second request cannot be overwritten
 * by a slow first one.
 */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (path === null) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.get<T>(path);
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Run a mutation with a shared pending flag and error message. */
export function useMutation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Something went wrong',
      );
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}

/** Short-lived confirmation message. */
export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();

  const show = useCallback((next: string) => {
    setMessage(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return [message, show];
}

/** Debounce a value, so a search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
