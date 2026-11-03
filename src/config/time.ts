// Datas e horas no fuso definido em config/ajustes.txt (padrão: America/Cuiaba).
import { setting } from './texts.ts';

const zone = () => setting('fuso', 'America/Cuiaba');
const part = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: zone(), ...options }).format(new Date(iso));
export const localDate = (iso: string) => part(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const localTime = (iso: string) => part(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
