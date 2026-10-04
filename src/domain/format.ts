export const formatNumber = (value: number) => new Intl.NumberFormat('es-GT').format(value);
export const formatMoney = (value: number) => `Q ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
export const formatDate = (value: string) => new Intl.DateTimeFormat('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Guatemala' }).format(new Date(value));
export const formatTime = (value: string) => new Intl.DateTimeFormat('es-GT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date(value));
export const formatToday = () => new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Guatemala' }).format(new Date());
