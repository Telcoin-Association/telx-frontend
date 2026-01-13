import React from 'react';
import { useSkrim } from '@/hooks/useSkrim';
import Skrim from '@/components/common/Skrim';

const SkrimContext = React.createContext<any>(null)

export const SkrimProvider = ({ children }: { children: any}) => {
  const methods = useSkrim()
  return (
    <SkrimContext.Provider value={methods}>
      {children}
      <Skrim when={methods.skrim} onClick={() => methods.clear()}>
        {methods.content}
      </Skrim>
    </SkrimContext.Provider>
    )
}

export const useSkrimContext = () => React.useContext(SkrimContext);
