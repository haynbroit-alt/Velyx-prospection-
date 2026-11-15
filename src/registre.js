// Registre en ajout seul, chaîné par empreinte (même discipline que l'espace commun de GALILÉE, CORTEX, LAVOISIER).
// Un seul compteur d'argent : les actes « encaissement », saisis par le propriétaire avec leur preuve. Tout le reste
// (budgets affichés, CA des cibles, valeur d'une mission) est un potentiel et ne s'additionne jamais aux gains.
import fs from 'node:fs';
import crypto from 'node:crypto';

const TYPES = ['mandat', 'observation', 'cible', 'pari', 'brouillon', 'envoi', 'reponse', 'encaissement', 'depense', 'aveu', 'lecon'];
const EXIGE = {
  mandat: ['texte', 'source', 'regle'],
  observation: ['source', 'mesure'],
  cible: ['recette', 'compte', 'fichier_prive'],
  pari: ['hypothese', 'geste_proprietaire', 'critere_succes', 'critere_arret', 'echeance'],
  brouillon: ['pari', 'fichier'],
  envoi: ['pari', 'canal'],
  reponse: ['pari', 'issue'],
  encaissement: ['montant_eur', 'preuve'],
  depense: ['montant_eur', 'objet', 'autorise_par'],
  aveu: ['motif'],
  lecon: ['texte', 'source'],
};
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export class Registre {
  constructor(fichier) {
    this.fichier = fichier;
    this.lignes = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  }
  ajouter(acte) {
    if (!TYPES.includes(acte.type)) throw new Error(`type inconnu : ${acte.type}`);
    const manque = EXIGE[acte.type].filter((k) => acte[k] === undefined || acte[k] === null || acte[k] === '');
    if (manque.length) throw new Error(`acte « ${acte.type} » refusé, il manque : ${manque.join(', ')}`);
    if (acte.type === 'depense' && acte.autorise_par !== 'proprietaire') throw new Error('dépense refusée : seul le propriétaire autorise une dépense');
    if (['envoi', 'encaissement'].includes(acte.type) && acte.auteur !== 'proprietaire') throw new Error(`« ${acte.type} » : seul le propriétaire envoie et encaisse`);
    // Relire le disque juste avant d'écrire : un autre processus (une longue lecture du registre en arrière-plan,
    // par exemple) a pu ajouter des lignes depuis l'ouverture. Sans cela, deux maillons pointent vers le même parent.
    if (fs.existsSync(this.fichier)) this.lignes = fs.readFileSync(this.fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const prec = this.lignes.at(-1)?.empreinte ?? 'origine';
    const corps = { n: this.lignes.length + 1, date: new Date().toISOString(), auteur: 'velyx', ...acte, precedente: prec };
    const ligne = { ...corps, empreinte: h(JSON.stringify(corps)) };
    fs.appendFileSync(this.fichier, JSON.stringify(ligne) + '\n');
    this.lignes.push(ligne);
    return ligne;
  }
  verifier() {
    let prec = 'origine';
    for (const l of this.lignes) {
      const { empreinte, ...corps } = l;
      if (corps.precedente !== prec || h(JSON.stringify(corps)) !== empreinte) return { ok: false, ligne: l.n };
      prec = empreinte;
    }
    return { ok: true, lignes: this.lignes.length };
  }
  etat() {
    const de = (t) => this.lignes.filter((l) => l.type === t);
    const issues = (id) => de('reponse').filter((r) => r.pari === id).map((r) => r.issue);
    return {
      encaisse_eur: de('encaissement').reduce((a, l) => a + l.montant_eur, 0),
      depense_eur: de('depense').reduce((a, l) => a + l.montant_eur, 0),
      paris: de('pari').map((p) => ({ id: p.id, hypothese: p.hypothese, echeance: p.echeance, envoye: de('envoi').some((e) => e.pari === p.id), issues: issues(p.id), geste: p.geste_proprietaire })),
    };
  }
}
