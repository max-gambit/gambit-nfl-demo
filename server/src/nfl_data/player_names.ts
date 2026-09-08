// Existing reviewed NFL player aliases, shared by snapshot builders and historical augmentation.
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function nameLookupKeys(name: string): string[] {
  const key = normalizeName(name);
  const aliases: Record<string, string[]> = {
    bamknight: ['zonovanknight'],
    camrobertson: ['cameronrobertson'],
    michaeljerrell: ['mikejerrell'],
    demetriusweatherspoon: ['dametriusweatherspoon'],
    mikejackson: ['michaeljackson'],
    camjackson: ['camronjackson'],
    camlewis: ['cameronlewis'],
    cameronross: ['camross'],
    chrisbrooks: ['christopherbrooks'],
    mattheworzech: ['mattorzech'],
    louishansen: ['louiehansen'],
    jacobhummel: ['jakehummel'],
    camrynbynum: ['cambynum'],
    foyeoluokun: ['foyesadeoluokun'],
    gregorydesrosiers: ['gregdesrosiers'],
    alzillionhamiltonon: ['alzillionhamilton'],
    eliasneal: ['elineal'],
    dreynorwood: ['dreydennorwood'],
    djglaze: ['delmarglaze'],
    christhomas: ['christianthomas'],
    andyborregales: ['andresborregales'],
    mikeonwenu: ['michaelonwenu'],
    matthewstafford: ['mattstafford'],
    kamcurl: ['kamrencurl'],
    cjgardnerjohnson: ['chaunceygardnerjohnson'],
    gregrousseau: ['gregoryrousseau'],
    michaeldanna: ['mikedanna'],
    olumuyiwafashanu: ['olufashanu'],
    mikejordan: ['michaeljordan'],
    riqwoolen: ['tariqwoolen'],
    gaberubio: ['gabrielrubio'],
    benskowronek: ['bennettskowronek'],
    oluoluwatimi: ['olusegunoluwatimi'],
    zachthomas: ['zacharythomas'],
    benjaminchukwuma: ['benchukwuma'],
    kennygainwell: ['kennethgainwell'],
    haggaindubuisi: ['haggaichisomndubuisi'],
    nicholassingleton: ['nicksingleton'],
    trentscott: ['trentonscott'],
    patssurtain: ['patricksurtain'],
    patsurtain: ['patricksurtain'],
    saucegardner: ['ahmadgardner'],
    samcosmi: ['samuelcosmi'],
    chigokonkwo: ['chigoziemokonkwo'],
    gunnerolszewski: ['gunnerolszewski'],
  };
  return [...new Set([key, ...(aliases[key] ?? [])])];
}
