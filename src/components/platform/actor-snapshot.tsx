'use client';
import {createContext,type ReactNode} from 'react';
export const ActorSnapshot=createContext<string|null>(null);
export default function ActorSnapshotProvider({actorId,children}:{actorId:string;children:ReactNode}){return <ActorSnapshot.Provider value={actorId}>{children}</ActorSnapshot.Provider>;}
