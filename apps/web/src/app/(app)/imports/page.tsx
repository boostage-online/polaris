'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ImportJob } from '@polaris/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  PageHeader,
  Table,
  Tabs,
  Textarea,
} from '@/components/ui';
import { imports } from '@/lib/resources';

type Kind = 'students' | 'guardians';

const HELP: Record<Kind, { title: string; columns: string; sample: string }> = {
  students: {
    title: 'Élèves (avec classe)',
    columns:
      'matricule (facultatif), nom, prénom, date de naissance (JJ/MM/AAAA), sexe, classe (nom exact, année courante)',
    sample:
      'Matricule;Nom;Prénom;Date de naissance;Sexe;Classe\n;KPOGNON;Éric;12/05/2014;M;6e A\n2026-00042;TOSSOU;Laure;01/07/2014;F;6e B',
  },
  guardians: {
    title: 'Tuteurs (avec rattachement)',
    columns:
      "matricule de l'élève, nom, prénom, téléphone (local ou +229…), e-mail (facultatif), lien (mère, père, tuteur)",
    sample:
      'matricule;nom;prenom;telephone;lien\n2026-00001;ADJOVI;Rosine;97 00 00 01;mère\n2026-00001;ADJOVI;Marc;+229 01 97 00 00 02;père',
  },
};

/**
 * Import CSV en deux temps : simulation (rapport sans écriture) puis application.
 * Séparateur , ou ; détecté ; en-têtes tolérants aux accents et à la casse.
 */
export default function ImportsPage() {
  const [kind, setKind] = useState<Kind>('students');
  const [csv, setCsv] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      kind === 'students' ? imports.students(csv, { dryRun }) : imports.guardians(csv, { dryRun }),
    onSuccess: (j) => setJob(j),
  });
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setJob(null);
  };
  const canApply = job?.dryRun === true && job.rowsOk > 0;

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="Collez ou chargez un fichier CSV, simulez, corrigez, puis appliquez."
      />
      <Tabs
        tabs={[
          { id: 'students', label: HELP.students.title },
          { id: 'guardians', label: HELP.guardians.title },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setJob(null);
        }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1. Fichier" className="lg:col-span-2">
          <p className="mb-2 text-sm text-slate-600">Colonnes : {HELP[kind].columns}.</p>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCsv(HELP[kind].sample);
                setJob(null);
              }}
            >
              Insérer un exemple
            </Button>
          </div>
          <Field label="Contenu CSV">
            <Textarea
              rows={12}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setJob(null);
              }}
              placeholder={HELP[kind].sample}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!csv.trim() || run.isPending}
              onClick={() => run.mutate(true)}
            >
              Simuler
            </Button>
            <Button
              disabled={!canApply || run.isPending}
              onClick={() => run.mutate(false)}
              title={canApply ? '' : 'Simulez d’abord'}
            >
              Appliquer l&apos;import
            </Button>
          </div>
          <div className="mt-3">
            <ErrorAlert error={run.error} />
          </div>
        </Card>
        <Card title="Règles">
          <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
            <li>5 000 lignes maximum par fichier.</li>
            <li>
              Un matricule existant met la fiche à jour ; sinon l&apos;élève est créé (matricule
              généré si vide).
            </li>
            <li>
              Une classe inconnue, une date illisible ou un doublon dans le fichier mettent la ligne
              en erreur ; les autres lignes passent.
            </li>
            <li>Un homonyme de même date de naissance est signalé (avertissement), pas bloqué.</li>
            <li>
              Tuteurs : un même téléphone désigne le même tuteur, même à travers plusieurs enfants.
            </li>
          </ul>
        </Card>
      </div>

      {job && (
        <Card
          className="mt-4"
          title={
            <span className="flex items-center gap-2">
              2. Rapport{' '}
              {job.dryRun ? <Badge>Simulation</Badge> : <Badge tone="green">Appliqué</Badge>}
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span>
              Lignes : <b>{job.rowsTotal}</b>
            </span>
            <span className="text-emerald-700">
              OK : <b>{job.rowsOk}</b>
            </span>
            <span className="text-red-700">
              Erreurs : <b>{job.rowsError}</b>
            </span>
            <span className="text-amber-700">
              Avertissements : <b>{job.report.filter((r) => r.status === 'WARNING').length}</b>
            </span>
          </div>
          {job.dryRun && job.rowsError > 0 && (
            <div className="mb-3">
              <Alert tone="warning">
                Les lignes en erreur seront ignorées à l&apos;application. Corrigez le fichier et
                simulez à nouveau pour tout importer.
              </Alert>
            </div>
          )}
          {!job.dryRun && (
            <div className="mb-3">
              <Alert tone="success">
                Import appliqué. Les fiches sont disponibles dans la liste des élèves.
              </Alert>
            </div>
          )}
          <Table
            head={
              <>
                <th>Ligne</th>
                <th>Clé</th>
                <th>Statut</th>
                <th>Message</th>
              </>
            }
          >
            {job.report
              .filter((r) => r.status !== 'OK')
              .concat(job.report.filter((r) => r.status === 'OK'))
              .map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td className="font-mono text-xs">{r.key ?? ''}</td>
                  <td>
                    <Badge
                      tone={r.status === 'OK' ? 'green' : r.status === 'WARNING' ? 'amber' : 'red'}
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td>{r.message}</td>
                </tr>
              ))}
          </Table>
        </Card>
      )}
    </>
  );
}
