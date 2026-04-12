import { DateRange } from "react-day-picker";

export function getCurrentWeekRange(): DateRange {
    const now = new Date();
    const dayOfWeek = now.getDay();

    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);

    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    saturday.setHours(23, 59, 59, 999);

    return {
        from: sunday,
        to: saturday,
    };
}

export function isDateInRange(dateStr: string, range: DateRange | undefined): boolean {
    if (!range?.from) return true;

    const orderDate = new Date(dateStr);
    if (isNaN(orderDate.getTime())) return true;

    const now = new Date();
    if (orderDate > now) return true;

    const fromDate = new Date(range.from);
    fromDate.setHours(0, 0, 0, 0);

    if (range.to) {
        const toDate = new Date(range.to);
        toDate.setHours(23, 59, 59, 999);
        return orderDate >= fromDate && orderDate <= toDate;
    }

    return orderDate >= fromDate;
}
