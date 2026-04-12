
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { OrderItem, Product } from '@shared/schema';

// --- Types ---

export type PickingItem = OrderItem & {
    product: Product;
    qtyPickedLocal: number; // Temporarily holds the quantity picked on the device
    statusLocal: 'pending' | 'picked' | 'synced'; // Local status for UI and sync
};

interface PickingSessionMetadata {
    orderId: string;
    sectionId: string;
    sessionId: string;
    lastHeartbeat: number;
}

interface PickingState {
    // Session Data
    activeSession: PickingSessionMetadata | null;
    items: PickingItem[];

    // UI State
    isLoading: boolean;
    error: string | null;

    // Actions
    startSession: (metadata: PickingSessionMetadata, items: PickingItem[]) => void;
    endSession: () => void;
    pickItem: (itemId: string, qty: number) => void;
    setItems: (items: PickingItem[]) => void;
    syncItem: (itemId: string) => void; // Marks item as synced with backend

    // Offline/Sync Queue (Simplified for now)
    // We will assume 'statusLocal' === 'picked' means it needs syncing
}

// --- IndexedDB Setup ---

interface PickingDB extends DBSchema {
    picking_store: {
        key: string;
        value: {
            state: PickingState;
            version: number;
        };
    };
}

const dbPromise = openDB<PickingDB>('wms-picking-db', 1, {
    upgrade(db) {
        db.createObjectStore('picking_store');
    },
});

// Custom Storage for Zustand to use IDB
const idbStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const db = await dbPromise;
        const value = await db.get('picking_store', name);
        return value ? JSON.stringify(value) : null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const db = await dbPromise;
        await db.put('picking_store', JSON.parse(value), name);
    },
    removeItem: async (name: string): Promise<void> => {
        const db = await dbPromise;
        await db.delete('picking_store', name);
    },
};

// --- Store Implementation ---

export const usePickingStore = create<PickingState>()(
    persist(
        (set, get) => ({
            activeSession: null,
            items: [],
            isLoading: false,
            error: null,

            startSession: (metadata, items) => {
                set({
                    activeSession: metadata,
                    items: items.map(i => ({
                        ...i,
                        qtyPickedLocal: i.qtyPicked || 0,
                        statusLocal: i.status === 'separado' ? 'synced' : 'pending'
                    })),
                    error: null
                });
            },

            endSession: () => {
                set({
                    activeSession: null,
                    items: [],
                    error: null
                });
            },

            pickItem: (itemId, qty) => {
                set(state => ({
                    items: state.items.map(item => {
                        if (item.id === itemId) {
                            // Logic to update local quantity
                            // Assuming full pick for now or cumulative? 
                            // Application logic should handle "add to existing" vs "overwrite".
                            // Here we set the total picked.
                            return {
                                ...item,
                                qtyPickedLocal: qty,
                                statusLocal: 'picked' // Marked as needing sync
                            };
                        }
                        return item;
                    })
                }));
            },

            setItems: (items) => {
                set({ items });
            },

            syncItem: (itemId) => {
                set(state => ({
                    items: state.items.map(item =>
                        item.id === itemId ? { ...item, statusLocal: 'synced' } : item
                    )
                }));
            }
        }),
        {
            name: 'picking-storage', // unique name
            storage: createJSONStorage(() => idbStorage),
        }
    )
);
