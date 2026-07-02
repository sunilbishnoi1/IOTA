import React, { createContext, useCallback, useContext, useState } from 'react';

interface CopyChipContextValue {
  activeMessageId: string | null;
  setActiveMessageId: (id: string | null) => void;
  dismiss: () => void;
}

const CopyChipContext = createContext<CopyChipContextValue | null>(null);

export const useCopyChip = (): CopyChipContextValue => {
  const ctx = useContext(CopyChipContext);
  if (!ctx) throw new Error('useCopyChip must be used within CopyChipProvider');
  return ctx;
};

export const CopyChipProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const dismiss = useCallback(() => setActiveMessageId(null), []);

  return (
    <CopyChipContext.Provider value={{ activeMessageId, setActiveMessageId, dismiss }}>
      {children}
    </CopyChipContext.Provider>
  );
};
