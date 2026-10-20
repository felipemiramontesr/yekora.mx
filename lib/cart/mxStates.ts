/**
 * The 32 Mexican states a purchase can ship to (FC 011), as the cart's state selector shows
 * them: ISO 3166-2:MX code without the MX- prefix and the Spanish and English names, in the
 * order of the shipping_zones catalog (migrations/002). A unit test keeps this list identical to
 * the migration, so the selector never offers a state the API does not know, or misses one.
 *
 * Only the state code is ever stored in the browser (yekora_cart_v1); never a postal code.
 *
 * @module
 */

/** One state of the selector. */
interface MexicanState {
  /** ISO 3166-2:MX code without the MX- prefix, e.g. ZAC. */
  code: string;
  /** Name in Spanish. */
  es: string;
  /** Name in English. */
  en: string;
}

/** Every federal entity, in catalog order. */
export const MEXICAN_STATES: readonly MexicanState[] = [
  { code: 'AGU', es: 'Aguascalientes', en: 'Aguascalientes' },
  { code: 'BCN', es: 'Baja California', en: 'Baja California' },
  { code: 'BCS', es: 'Baja California Sur', en: 'Baja California Sur' },
  { code: 'CAM', es: 'Campeche', en: 'Campeche' },
  { code: 'CHP', es: 'Chiapas', en: 'Chiapas' },
  { code: 'CHH', es: 'Chihuahua', en: 'Chihuahua' },
  { code: 'CMX', es: 'Ciudad de México', en: 'Mexico City' },
  { code: 'COA', es: 'Coahuila', en: 'Coahuila' },
  { code: 'COL', es: 'Colima', en: 'Colima' },
  { code: 'DUR', es: 'Durango', en: 'Durango' },
  { code: 'MEX', es: 'Estado de México', en: 'State of Mexico' },
  { code: 'GUA', es: 'Guanajuato', en: 'Guanajuato' },
  { code: 'GRO', es: 'Guerrero', en: 'Guerrero' },
  { code: 'HID', es: 'Hidalgo', en: 'Hidalgo' },
  { code: 'JAL', es: 'Jalisco', en: 'Jalisco' },
  { code: 'MIC', es: 'Michoacán', en: 'Michoacán' },
  { code: 'MOR', es: 'Morelos', en: 'Morelos' },
  { code: 'NAY', es: 'Nayarit', en: 'Nayarit' },
  { code: 'NLE', es: 'Nuevo León', en: 'Nuevo León' },
  { code: 'OAX', es: 'Oaxaca', en: 'Oaxaca' },
  { code: 'PUE', es: 'Puebla', en: 'Puebla' },
  { code: 'QUE', es: 'Querétaro', en: 'Querétaro' },
  { code: 'ROO', es: 'Quintana Roo', en: 'Quintana Roo' },
  { code: 'SLP', es: 'San Luis Potosí', en: 'San Luis Potosí' },
  { code: 'SIN', es: 'Sinaloa', en: 'Sinaloa' },
  { code: 'SON', es: 'Sonora', en: 'Sonora' },
  { code: 'TAB', es: 'Tabasco', en: 'Tabasco' },
  { code: 'TAM', es: 'Tamaulipas', en: 'Tamaulipas' },
  { code: 'TLA', es: 'Tlaxcala', en: 'Tlaxcala' },
  { code: 'VER', es: 'Veracruz', en: 'Veracruz' },
  { code: 'YUC', es: 'Yucatán', en: 'Yucatán' },
  { code: 'ZAC', es: 'Zacatecas', en: 'Zacatecas' },
];
