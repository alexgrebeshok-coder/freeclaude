import { useEffect, useState } from 'react';

const DEFAULT_VERSION = '0.1.0';

export function useAppVersion(): string {
  const [version, setVersion] = useState(DEFAULT_VERSION);

  useEffect(() => {
    let isMounted = true;

    const loadVersion = async () => {
      try {
        const loadedVersion = await window.electron.app.getVersion();
        if (isMounted && loadedVersion) {
          setVersion(loadedVersion);
        }
      } catch (error) {
        console.error('Failed to load app version:', error);
      }
    };

    void loadVersion();

    return () => {
      isMounted = false;
    };
  }, []);

  return version;
}
