/**
 * ISO 4217 currency list (active codes, including fund and precious-metal codes).
 * Platform-neutral: no DOM or Intl dependency, so web and mobile share it.
 */
export interface CurrencyInfo {
  code: string
  name: string
  /** Common display symbol; falls back to the code when there is none. */
  symbol: string
  /** Minor-unit digits (2 for cents, 0 for JPY, 3 for KWD). */
  digits: number
}

// [code, name, symbol, digits]
const RAW: [string, string, string, number][] = [
  ['AED', 'UAE Dirham', 'د.إ', 2], ['AFN', 'Afghan Afghani', '؋', 2], ['ALL', 'Albanian Lek', 'L', 2],
  ['AMD', 'Armenian Dram', '֏', 2], ['AOA', 'Angolan Kwanza', 'Kz', 2], ['ARS', 'Argentine Peso', '$', 2],
  ['AUD', 'Australian Dollar', 'A$', 2], ['AWG', 'Aruban Florin', 'ƒ', 2], ['AZN', 'Azerbaijani Manat', '₼', 2],
  ['BAM', 'Bosnia-Herzegovina Convertible Mark', 'KM', 2], ['BBD', 'Barbados Dollar', 'Bds$', 2], ['BDT', 'Bangladeshi Taka', '৳', 2],
  ['BHD', 'Bahraini Dinar', '.د.ب', 3], ['BIF', 'Burundian Franc', 'FBu', 0], ['BMD', 'Bermudian Dollar', 'BD$', 2],
  ['BND', 'Brunei Dollar', 'B$', 2], ['BOB', 'Bolivian Boliviano', 'Bs', 2], ['BOV', 'Bolivian Mvdol', 'BOV', 2],
  ['BRL', 'Brazilian Real', 'R$', 2], ['BSD', 'Bahamian Dollar', 'B$', 2], ['BTN', 'Bhutanese Ngultrum', 'Nu.', 2],
  ['BWP', 'Botswana Pula', 'P', 2], ['BYN', 'Belarusian Ruble', 'Br', 2], ['BZD', 'Belize Dollar', 'BZ$', 2],
  ['CAD', 'Canadian Dollar', 'C$', 2], ['CDF', 'Congolese Franc', 'FC', 2], ['CHE', 'WIR Euro', 'CHE', 2],
  ['CHF', 'Swiss Franc', 'CHF', 2], ['CHW', 'WIR Franc', 'CHW', 2], ['CLF', 'Chilean Unit of Account (UF)', 'UF', 4],
  ['CLP', 'Chilean Peso', '$', 0], ['CNY', 'Chinese Yuan', '¥', 2], ['COP', 'Colombian Peso', '$', 2],
  ['COU', 'Colombian Real Value Unit', 'COU', 2], ['CRC', 'Costa Rican Colon', '₡', 2], ['CUP', 'Cuban Peso', '$', 2],
  ['CVE', 'Cape Verdean Escudo', 'Esc', 2], ['CZK', 'Czech Koruna', 'Kč', 2], ['DJF', 'Djiboutian Franc', 'Fdj', 0],
  ['DKK', 'Danish Krone', 'kr', 2], ['DOP', 'Dominican Peso', 'RD$', 2], ['DZD', 'Algerian Dinar', 'د.ج', 2],
  ['EGP', 'Egyptian Pound', 'E£', 2], ['ERN', 'Eritrean Nakfa', 'Nfk', 2], ['ETB', 'Ethiopian Birr', 'Br', 2],
  ['EUR', 'Euro', '€', 2], ['FJD', 'Fijian Dollar', 'FJ$', 2], ['FKP', 'Falkland Islands Pound', '£', 2],
  ['GBP', 'British Pound', '£', 2], ['GEL', 'Georgian Lari', '₾', 2], ['GHS', 'Ghanaian Cedi', 'GH₵', 2],
  ['GIP', 'Gibraltar Pound', '£', 2], ['GMD', 'Gambian Dalasi', 'D', 2], ['GNF', 'Guinean Franc', 'FG', 0],
  ['GTQ', 'Guatemalan Quetzal', 'Q', 2], ['GYD', 'Guyanese Dollar', 'G$', 2], ['HKD', 'Hong Kong Dollar', 'HK$', 2],
  ['HNL', 'Honduran Lempira', 'L', 2], ['HTG', 'Haitian Gourde', 'G', 2], ['HUF', 'Hungarian Forint', 'Ft', 2],
  ['IDR', 'Indonesian Rupiah', 'Rp', 2], ['ILS', 'Israeli New Shekel', '₪', 2], ['INR', 'Indian Rupee', '₹', 2],
  ['IQD', 'Iraqi Dinar', 'ع.د', 3], ['IRR', 'Iranian Rial', '﷼', 2], ['ISK', 'Icelandic Krona', 'kr', 0],
  ['JMD', 'Jamaican Dollar', 'J$', 2], ['JOD', 'Jordanian Dinar', 'JD', 3], ['JPY', 'Japanese Yen', '¥', 0],
  ['KES', 'Kenyan Shilling', 'KSh', 2], ['KGS', 'Kyrgyzstani Som', 'с', 2], ['KHR', 'Cambodian Riel', '៛', 2],
  ['KMF', 'Comorian Franc', 'CF', 0], ['KPW', 'North Korean Won', '₩', 2], ['KRW', 'South Korean Won', '₩', 0],
  ['KWD', 'Kuwaiti Dinar', 'KD', 3], ['KYD', 'Cayman Islands Dollar', 'CI$', 2], ['KZT', 'Kazakhstani Tenge', '₸', 2],
  ['LAK', 'Lao Kip', '₭', 2], ['LBP', 'Lebanese Pound', 'L£', 2], ['LKR', 'Sri Lankan Rupee', 'Rs', 2],
  ['LRD', 'Liberian Dollar', 'L$', 2], ['LSL', 'Lesotho Loti', 'L', 2], ['LYD', 'Libyan Dinar', 'LD', 3],
  ['MAD', 'Moroccan Dirham', 'د.م.', 2], ['MDL', 'Moldovan Leu', 'L', 2], ['MGA', 'Malagasy Ariary', 'Ar', 2],
  ['MKD', 'Macedonian Denar', 'ден', 2], ['MMK', 'Myanmar Kyat', 'K', 2], ['MNT', 'Mongolian Tugrik', '₮', 2],
  ['MOP', 'Macanese Pataca', 'MOP$', 2], ['MRU', 'Mauritanian Ouguiya', 'UM', 2], ['MUR', 'Mauritian Rupee', 'Rs', 2],
  ['MVR', 'Maldivian Rufiyaa', 'Rf', 2], ['MWK', 'Malawian Kwacha', 'MK', 2], ['MXN', 'Mexican Peso', 'MX$', 2],
  ['MXV', 'Mexican Unidad de Inversion (UDI)', 'MXV', 2], ['MYR', 'Malaysian Ringgit', 'RM', 2], ['MZN', 'Mozambican Metical', 'MT', 2],
  ['NAD', 'Namibian Dollar', 'N$', 2], ['NGN', 'Nigerian Naira', '₦', 2], ['NIO', 'Nicaraguan Cordoba', 'C$', 2],
  ['NOK', 'Norwegian Krone', 'kr', 2], ['NPR', 'Nepalese Rupee', 'Rs', 2], ['NZD', 'New Zealand Dollar', 'NZ$', 2],
  ['OMR', 'Omani Rial', 'ر.ع.', 3], ['PAB', 'Panamanian Balboa', 'B/.', 2], ['PEN', 'Peruvian Sol', 'S/', 2],
  ['PGK', 'Papua New Guinean Kina', 'K', 2], ['PHP', 'Philippine Peso', '₱', 2], ['PKR', 'Pakistani Rupee', 'Rs', 2],
  ['PLN', 'Polish Zloty', 'zł', 2], ['PYG', 'Paraguayan Guarani', '₲', 0], ['QAR', 'Qatari Riyal', 'QR', 2],
  ['RON', 'Romanian Leu', 'lei', 2], ['RSD', 'Serbian Dinar', 'дин.', 2], ['RUB', 'Russian Ruble', '₽', 2],
  ['RWF', 'Rwandan Franc', 'FRw', 0], ['SAR', 'Saudi Riyal', 'SR', 2], ['SBD', 'Solomon Islands Dollar', 'SI$', 2],
  ['SCR', 'Seychellois Rupee', 'SR', 2], ['SDG', 'Sudanese Pound', 'SDG', 2], ['SEK', 'Swedish Krona', 'kr', 2],
  ['SGD', 'Singapore Dollar', 'S$', 2], ['SHP', 'Saint Helena Pound', '£', 2], ['SLE', 'Sierra Leonean Leone', 'Le', 2],
  ['SOS', 'Somali Shilling', 'Sh', 2], ['SRD', 'Surinamese Dollar', 'Sr$', 2], ['SSP', 'South Sudanese Pound', 'SS£', 2],
  ['STN', 'Sao Tome and Principe Dobra', 'Db', 2], ['SVC', 'Salvadoran Colon', '₡', 2], ['SYP', 'Syrian Pound', 'LS', 2],
  ['SZL', 'Swazi Lilangeni', 'E', 2], ['THB', 'Thai Baht', '฿', 2], ['TJS', 'Tajikistani Somoni', 'SM', 2],
  ['TMT', 'Turkmenistani Manat', 'm', 2], ['TND', 'Tunisian Dinar', 'DT', 3], ['TOP', 'Tongan Paanga', 'T$', 2],
  ['TRY', 'Turkish Lira', '₺', 2], ['TTD', 'Trinidad and Tobago Dollar', 'TT$', 2], ['TWD', 'New Taiwan Dollar', 'NT$', 2],
  ['TZS', 'Tanzanian Shilling', 'TSh', 2], ['UAH', 'Ukrainian Hryvnia', '₴', 2], ['UGX', 'Ugandan Shilling', 'USh', 0],
  ['USD', 'US Dollar', '$', 2], ['USN', 'US Dollar (Next day)', 'USN', 2], ['UYI', 'Uruguay Peso en Unidades Indexadas', 'UYI', 0],
  ['UYU', 'Uruguayan Peso', '$U', 2], ['UYW', 'Uruguayan Unidad Previsional', 'UYW', 4], ['UZS', 'Uzbekistani Som', 'soʻm', 2],
  ['VED', 'Venezuelan Digital Bolivar', 'Bs.D', 2], ['VES', 'Venezuelan Bolivar', 'Bs.S', 2], ['VND', 'Vietnamese Dong', '₫', 0],
  ['VUV', 'Vanuatu Vatu', 'VT', 0], ['WST', 'Samoan Tala', 'WS$', 2], ['XAF', 'Central African CFA Franc', 'FCFA', 0],
  ['XAG', 'Silver (troy ounce)', 'XAG', 0], ['XAU', 'Gold (troy ounce)', 'XAU', 0], ['XBA', 'European Composite Unit', 'XBA', 0],
  ['XBB', 'European Monetary Unit', 'XBB', 0], ['XBC', 'European Unit of Account 9', 'XBC', 0], ['XBD', 'European Unit of Account 17', 'XBD', 0],
  ['XCD', 'East Caribbean Dollar', 'EC$', 2], ['XCG', 'Caribbean Guilder', 'Cg', 2], ['XDR', 'IMF Special Drawing Rights', 'SDR', 0],
  ['XOF', 'West African CFA Franc', 'CFA', 0], ['XPD', 'Palladium (troy ounce)', 'XPD', 0], ['XPF', 'CFP Franc', '₣', 0],
  ['XPT', 'Platinum (troy ounce)', 'XPT', 0], ['XSU', 'Sucre', 'XSU', 0], ['XTS', 'Testing Code', 'XTS', 0],
  ['XUA', 'ADB Unit of Account', 'XUA', 0], ['XXX', 'No Currency', 'XXX', 0], ['YER', 'Yemeni Rial', '﷼', 2],
  ['ZAR', 'South African Rand', 'R', 2], ['ZMW', 'Zambian Kwacha', 'ZK', 2], ['ZWG', 'Zimbabwe Gold', 'ZiG', 2],
]

export const CURRENCIES: CurrencyInfo[] = RAW.map(([code, name, symbol, digits]) => ({ code, name, symbol, digits }))

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

/** Looks up a currency by ISO code (case-insensitive). */
export function currencyInfo(code: string | null | undefined): CurrencyInfo | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined
}

/** "USD - US Dollar ($)"; unknown codes come back as-is. */
export function currencyLabel(code: string | null | undefined, withSymbol = true): string {
  const c = currencyInfo(code)
  if (!c) return (code || '').toUpperCase()
  return `${c.code} - ${c.name}${withSymbol && c.symbol !== c.code ? ` (${c.symbol})` : ''}`
}
