import { useEffect, useRef } from 'react';

export function useSSE(url: string, eventTypes: string[], onMessage: (type: string, data: any) => void) {
    const eventSourceRef = useRef<EventSource | null>(null);
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    const eventTypesKey = JSON.stringify(eventTypes);

    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        const listeners: { type: string; listener: (e: MessageEvent) => void }[] = [];

        eventTypes.forEach((type) => {
            const listener = (event: MessageEvent) => {
                try {
                    const parsedData = JSON.parse(event.data);
                    onMessageRef.current(type, parsedData);
                } catch (error) {
                    console.error(`Error parsing SSE data for ${type}:`, error);
                }
            };
            eventSource.addEventListener(type, listener);
            listeners.push({ type, listener });
        });

        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            if (eventSource.readyState === EventSource.CLOSED) {
            }
        };

        return () => {
            listeners.forEach(({ type, listener }) => {
                eventSource.removeEventListener(type, listener);
            });
            eventSource.close();
        };
    }, [url, eventTypesKey]);

    return eventSourceRef.current;
}
