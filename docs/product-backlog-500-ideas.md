# Backlog ProxmoxCenter: 500 idées non traitées

État de référence: revue du 27 mars 2026.

Ce document regroupe 500 idées nouvelles ou non encore traitées dans le produit, classées par thème pour faciliter le tri futur.

## UX générale (1-25)

1. Ajouter un mode densité d’interface `compact / standard / confort`.
2. Permettre un tableau de bord d’accueil entièrement réorganisable par drag and drop.
3. Ajouter un sélecteur `vue opérateur / vue admin / vue lecture`.
4. Créer une barre de commandes globale avec raccourci `Cmd/Ctrl + K`.
5. Ajouter des raccourcis clavier pour inventaire, création, sauvegardes et observabilité.
6. Proposer un fil d’Ariane persisté et cohérent sur toutes les vues profondes.
7. Ajouter un mode focus qui masque toutes les cartes secondaires.
8. Permettre d’épingler ses pages ou filtres favoris dans la sidebar.
9. Ajouter un panneau `récemment consulté` pour VM, nœuds et sauvegardes.
10. Afficher un mini aperçu au survol des liens vers VM ou nœuds.
11. Ajouter un système de tags visuels cohérent pour `critique`, `action requise`, `lecture seule`.
12. Créer un vrai mode kiosque / NOC pour affichage sur grand écran.
13. Ajouter une aide contextuelle discrète par écran avec exemples concrets.
14. Permettre de masquer durablement certains blocs visuels inutiles pour un utilisateur.
15. Créer un centre de préférences UI utilisateur stocké côté app.
16. Ajouter un historique de navigation interne avec retour rapide.
17. Créer des en-têtes collants plus fins sur les longues pages.
18. Ajouter des ancres de section avec navigation latérale sur les écrans longs.
19. Proposer un mode impression propre pour les grandes vues.
20. Ajouter des modèles de mise en page `simple`, `technique`, `direction`.
21. Ajouter une vraie palette de couleurs par statut uniforme dans toute l’app.
22. Intégrer des micro-animations de transition entre sous-onglets plutôt que des rechargements secs.
23. Afficher la source de donnée en haut de chaque carte importante.
24. Ajouter un mode `apprentissage` qui explique chaque écran la première fois.
25. Créer un moteur de feedback in-app pour signaler une UI confuse en un clic.

## Accessibilité et personnalisation (26-50)

26. Ajouter un audit WCAG automatique sur les contrastes des thèmes.
27. Permettre de grossir uniquement les titres sans grossir toute l’interface.
28. Ajouter un mode `hauts contrastes`.
29. Ajouter un mode `daltonisme` avec palettes adaptées.
30. Améliorer le focus clavier visible sur toutes les actions.
31. Rendre tous les graphes lisibles avec une alternative tableau accessible.
32. Ajouter une navigation 100% clavier sur l’inventaire.
33. Ajouter des annonces ARIA plus propres sur les actions longues.
34. Permettre de réduire ou couper toutes les animations au niveau utilisateur.
35. Ajouter un choix de taille de texte `petit / normal / grand / très grand`.
36. Ajouter une police plus lisible dédiée aux environnements d’exploitation.
37. Rendre les graphes exploitables sans couleur seule, avec formes ou motifs.
38. Ajouter un thème clair orienté bureautique plus sobre.
39. Ajouter un thème `NOC` très sombre pour affichage continu.
40. Permettre d’inverser la disposition contenu/side panel dans les pages denses.
41. Ajouter une option pour figer les colonnes importantes dans les tableaux.
42. Ajouter un mode `ligne par ligne` pour les utilisateurs sensibles aux cartes.
43. Créer des descriptions alternatives automatiques pour badges et icônes.
44. Ajouter une aide à la lecture sur les écrans longs avec repères de progression.
45. Permettre un réglage indépendant des espacements d’interface.
46. Ajouter un mode de comparaison visuelle plus accessible pour avant/après.
47. Permettre de mémoriser les préférences par poste et par utilisateur.
48. Ajouter des indicateurs textuels explicites sur tous les statuts critiques.
49. Ajouter un tutoriel clavier pour opérateur power user.
50. Prévoir une traduction complète FR/EN/ES/DE avec moteur i18n propre.

## Inventaire, recherche et vues globales (51-75)

51. Ajouter une vraie recherche plein texte unifiée VM, CT, nœuds, stockages et notes.
52. Permettre des filtres sauvegardés et partageables par URL.
53. Ajouter un mode `comparaison` de plusieurs VM côte à côte.
54. Ajouter un tri multi-colonnes dans les tableaux de l’inventaire.
55. Afficher les ressources orphelines directement dans l’inventaire.
56. Ajouter une vue `tout ce qui est à l’arrêt depuis plus de X jours`.
57. Ajouter une vue `tout ce qui consomme le plus`.
58. Ajouter une vue `tout ce qui n’a pas été sauvegardé récemment`.
59. Ajouter un mode `anomalies` sur l’inventaire.
60. Permettre de filtrer par tag, propriétaire, environnement ou criticité.
61. Ajouter une colonne `dernier changement` par ressource.
62. Ajouter des vues regroupées par nœud, projet, client ou service.
63. Permettre une vue arborescente cluster > nœud > workload > disques/NIC.
64. Ajouter un export CSV/JSON de l’inventaire filtré.
65. Ajouter une vraie pagination ou virtualisation sur gros clusters.
66. Permettre d’épingler des colonnes visibles selon le rôle.
67. Ajouter des aperçus de config sans quitter la vue liste.
68. Ajouter un `mode incident` qui ne montre que les ressources à problème.
69. Ajouter une carte `ressources sans agent` ou `avec agent cassé`.
70. Afficher les dépendances HA et backup directement dans les lignes d’inventaire.
71. Ajouter une vue `changements récents` sur les workloads.
72. Permettre des filtres complexes de type `CPU > 80% ET sans backup`.
73. Ajouter un mini tableau de bord inventaire par projet ou client.
74. Ajouter une vue `nouvelles ressources de la semaine`.
75. Ajouter des actions groupées depuis la vue liste.

## VM et CT: cycle de vie (76-100)

76. Permettre un renommage massif des ressources avec prévisualisation.
77. Ajouter un clone complet ou linked clone depuis l’interface.
78. Ajouter une duplication de configuration sans démarrer de wizard à zéro.
79. Ajouter un assistant de redimensionnement CPU/RAM basé sur l’usage réel.
80. Ajouter une vue `avant/après` lors des modifications de config VM.
81. Permettre de réordonner les interfaces réseau et les disques.
82. Ajouter la gestion simple du hotplug des ressources.
83. Ajouter un mode `planifier changement de configuration`.
84. Ajouter un historique détaillé des changements de config VM/CT.
85. Ajouter des modèles de profils `petite VM`, `app`, `db`, `windows`.
86. Ajouter une bibliothèque de templates OS et applicatifs.
87. Ajouter un score de conformité par VM selon des règles internes.
88. Ajouter une vue `ressources surdimensionnées`.
89. Ajouter une vue `ressources sous-dimensionnées`.
90. Ajouter un assistant de nettoyage des snapshots anciens par VM.
91. Ajouter un gestionnaire de notes riches par VM/CT.
92. Ajouter une carte `SLA / criticité / propriétaire` dans chaque fiche.
93. Ajouter un aperçu de l’ordre de boot et sa modification.
94. Ajouter une gestion plus fine des périphériques PCI/USB.
95. Ajouter un comparateur de configuration entre deux VM.
96. Ajouter une timeline complète d’une VM: création, modifs, backups, incidents.
97. Ajouter un bouton de génération d’inventaire technique PDF par VM.
98. Ajouter un mode `maintenance` visible et historisé par ressource.
99. Ajouter des checklists d’exploitation par type de VM.
100. Permettre d’associer une documentation interne ou runbook à une VM.

## Création, templates et provisioning (101-125)

101. Ajouter un wizard de création `rapide` et un wizard `avancé`.
102. Ajouter des presets d’entreprise par environnement `prod`, `préprod`, `dev`.
103. Ajouter la création depuis template cloud-init plus visuelle.
104. Ajouter un import d’images cloud directement depuis fournisseurs publics.
105. Ajouter un validateur de sizing avant création.
106. Ajouter un calcul automatique du meilleur nœud cible.
107. Ajouter des règles d’affinité ou anti-affinité lors de la création.
108. Ajouter une création multi-VM en lot depuis un plan.
109. Ajouter un import CSV/YAML pour créer plusieurs VM d’un coup.
110. Ajouter un préremplissage depuis une VM existante.
111. Ajouter une bibliothèque interne de `blueprints`.
112. Ajouter une prévisualisation finale en mode fiche lisible avant validation.
113. Ajouter un mode `simulation sans exécution`.
114. Ajouter un résumé des coûts énergétiques estimés avant création.
115. Ajouter des dépendances applicatives dans le wizard `web + db + cache`.
116. Ajouter un bloc `sécurité de base` directement pendant la création.
117. Ajouter un contrôle des noms et conventions d’entreprise.
118. Ajouter un moteur de règles pour imposer des choix selon le contexte.
119. Ajouter une étape optionnelle de scripts post-création.
120. Ajouter un système de variables réutilisables dans les modèles.
121. Ajouter une création guidée entièrement conversationnelle par l’assistant.
122. Ajouter une importation Terraform/Ansible vers wizard visuel.
123. Ajouter un rollback automatique si une étape intermédiaire échoue.
124. Ajouter une file de provisioning avec vraie progression multi-étapes.
125. Ajouter une validation croisée stockage/réseau/CPU avant envoi à Proxmox.

## Nœuds et opérations cluster (126-150)

126. Ajouter une vue de maintenance cluster avec état de chaque nœud.
127. Ajouter la mise en maintenance d’un nœud avec impact estimé.
128. Ajouter un check pré-reboot nœud avant action.
129. Ajouter un planificateur de redémarrage hors heures ouvrées.
130. Ajouter une vue de capacité restante par nœud après évacuation.
131. Ajouter une gestion plus visuelle du quorum et du cluster health.
132. Ajouter une vue réseau cluster dédiée.
133. Ajouter un tableau de drift de configuration entre nœuds.
134. Ajouter un assistant de migration des workloads hors d’un nœud.
135. Ajouter un mode `drain node` en un clic avec suivi.
136. Ajouter une checklist de patch management par nœud.
137. Ajouter une vue `nœuds les plus instables`.
138. Ajouter une synthèse de firmware/BIOS/microcode quand disponible.
139. Ajouter une vue `ressources réservées vs utilisées` par nœud.
140. Ajouter un historique des incidents par nœud.
141. Ajouter un diagnostic intégré `pourquoi ce nœud est saturé`.
142. Ajouter une vue `balancing` des charges cluster.
143. Ajouter un mode `avant patch` avec export des impacts.
144. Ajouter des recommandations de consolidation de nœuds.
145. Ajouter un score de santé par nœud.
146. Ajouter une vue des interfaces physiques et VLAN réellement utilisés.
147. Ajouter la visualisation des jobs de maintenance en attente.
148. Ajouter une gestion simplifiée des tâches cluster fréquentes.
149. Ajouter un plan de capacité CPU/RAM/stockage par nœud sur 90 jours.
150. Ajouter une synthèse journalière des événements nœud.

## Stockage et réseau (151-175)

151. Ajouter une cartographie des stockages utilisables par VM, CT, ISO et backup.
152. Ajouter un explorateur de contenu stockage plus rapide avec recherche.
153. Ajouter un mode `stockages à risque` basé sur taux d’occupation et erreurs.
154. Ajouter un bilan de fragmentation ou dispersion des disques.
155. Ajouter la comparaison des performances perçues selon stockage.
156. Ajouter une vue `volumes orphelins`.
157. Ajouter un assistant de migration disque entre stockages.
158. Ajouter une validation automatique des contenus autorisés par stockage.
159. Ajouter un tableau de latence IO par stockage si disponible.
160. Ajouter une recommandation de placement par type de workload.
161. Ajouter une visualisation des bridges, bonds et VLAN du cluster.
162. Ajouter un mapping VM -> bridge -> interface physique.
163. Ajouter un contrôle de cohérence réseau entre nœuds.
164. Ajouter un mode `quelles VM passent par ce bridge`.
165. Ajouter une vue `sous-réseaux détectés`.
166. Ajouter une aide pour éviter les collisions d’IP connues.
167. Ajouter un diagnostic réseau sur perte de connectivité guest.
168. Ajouter une détection de saturation des interfaces physiques.
169. Ajouter une visualisation des montées de débit anormales.
170. Ajouter une vue `disques les plus lents`.
171. Ajouter des alertes de croissance stockage par tendance.
172. Ajouter un assistant de nettoyage des ISO inutiles.
173. Ajouter une vue `snapshots qui bloquent de la place`.
174. Ajouter la projection de date de saturation d’un stockage.
175. Ajouter une carte `réseau critique` par workload et par nœud.

## Sauvegardes, PBS et cloud (176-200)

176. Ajouter un assistant pas à pas de création de stratégie de sauvegarde.
177. Ajouter une vérification de cohérence complète avant activation d’un plan.
178. Ajouter des modèles de rétention `court`, `standard`, `long terme`, `compliance`.
179. Ajouter un tableau `dernière sauvegarde réussie` par ressource.
180. Ajouter un score de couverture backup du cluster.
181. Ajouter une vue `plans sans cible valide`.
182. Ajouter un mode `prévoir l’espace nécessaire` selon rétention.
183. Ajouter une carte `coût estimé cloud` par plan.
184. Ajouter une vérification de bande passante avant backup cloud massif.
185. Ajouter un staging intelligent selon taille et horaire.
186. Ajouter une priorisation des jobs de backup.
187. Ajouter un planificateur de fenêtres de backup par groupe de VM.
188. Ajouter un état `sain / dégradé / cassé` par cible de sauvegarde.
189. Ajouter une vue `prochaine saturation de la cible backup`.
190. Ajouter un mode `pause des backups` avec motif et rappel.
191. Ajouter une gestion plus simple des exclusions par disque ou VM.
192. Ajouter une détection des plans redondants ou incohérents.
193. Ajouter un comparateur `PBS vs cloud` en coût et rétention.
194. Ajouter une vue `sauvegardes les plus volumineuses`.
195. Ajouter une déduplication logique des plans visuellement proches.
196. Ajouter des sauvegardes déclenchées par événement et non seulement planning.
197. Ajouter un contrôle explicite des permissions cloud avant premier run.
198. Ajouter une vue `toutes les cibles disponibles` avec tests.
199. Ajouter une recommandation automatique de plan selon criticité.
200. Ajouter un rapport de conformité backup exportable.

## Restauration et PRA (201-225)

201. Ajouter un wizard de restauration `fichier`, `VM`, `CT`, `volume`.
202. Ajouter une restauration partielle sur nouveau VMID guidée.
203. Ajouter un mode `restauration à blanc` pour test.
204. Ajouter une validation de destination avant restauration.
205. Ajouter une estimation du temps de restauration avant lancement.
206. Ajouter un runbook de PRA attaché à chaque plan critique.
207. Ajouter un calendrier des tests de restauration périodiques.
208. Ajouter une vue `restaurations jamais testées`.
209. Ajouter un score de confiance PRA par workload.
210. Ajouter une simulation d’impact de restauration sur la capacité.
211. Ajouter la comparaison entre backup choisi et état actuel avant restore.
212. Ajouter un mode de restauration avec remappage réseau assisté.
213. Ajouter un mode `restauration isolée` pour forensic.
214. Ajouter un suivi de progression de restauration plus précis par étape.
215. Ajouter une vérification post-restore automatisée.
216. Ajouter une documentation automatique du restore effectué.
217. Ajouter un export du compte-rendu PRA après test.
218. Ajouter un mode `recovery point advisor`.
219. Ajouter des suggestions de point de restauration selon incidents.
220. Ajouter une vue `ressources restaurables maintenant`.
221. Ajouter un inventaire des artefacts récupérables par sauvegarde.
222. Ajouter un workflow d’approbation avant restore critique.
223. Ajouter une sandbox de restauration temporaire.
224. Ajouter une vue `RTO/RPO observés`.
225. Ajouter une campagne automatique de test de restauration mensuelle.

## Observabilité live et métriques (226-250)

226. Ajouter des graphes multi-séries CPU/RAM/réseau/IO par nœud en superposition.
227. Ajouter un mode `corrélation` entre CPU, IO et réseau.
228. Ajouter une vue `top variations` plutôt que juste les niveaux instantanés.
229. Ajouter un explorateur de pics avec zoom sur plage horaire.
230. Ajouter des annotations d’événements sur les graphes.
231. Ajouter une ligne `moyenne`, `max`, `95e percentile` sur chaque graphe.
232. Ajouter un mode heatmap d’usage par heure et par jour.
233. Ajouter une comparaison `aujourd’hui vs hier / semaine dernière`.
234. Ajouter une vue `workloads les plus bavards réseau`.
235. Ajouter un mode `explication des unités` intégré aux graphes.
236. Ajouter un sélecteur de granularité manuel sur les courbes.
237. Ajouter un mode `anomalies détectées` sur les métriques.
238. Ajouter une timeline des incidents corrélée aux métriques.
239. Ajouter un stockage longue durée local des métriques importantes.
240. Ajouter des seuils personnalisés par VM ou par nœud.
241. Ajouter une carte `MTTD / MTTR` sur les incidents détectés.
242. Ajouter une vue des variations de charge en pourcentage par période.
243. Ajouter un export CSV multi-métriques avec période personnalisée.
244. Ajouter un tableau de saturation progressive par ressource.
245. Ajouter une alerte de dérive continue et non juste de seuil instantané.
246. Ajouter une vue `qualité de la donnée` par source métrique.
247. Ajouter la comparaison entre réservé et réellement consommé.
248. Ajouter une vue `sous-utilisé depuis 30 jours`.
249. Ajouter des seuils métier `normal / attention / critique` configurables.
250. Ajouter une vue `capacité restante estimée` par ressource.

## GreenIT et énergie (251-275)

251. Ajouter un bilan énergétique par VM et pas seulement global cluster.
252. Ajouter une ventilation estimée par service ou par client.
253. Ajouter un mode `avant / après optimisation`.
254. Ajouter une comparaison par mois, saison et météo.
255. Ajouter une vue `énergie gaspillée` des workloads sous-utilisés.
256. Ajouter un ratio `W / VM utile` ou `W / workload actif`.
257. Ajouter une vue de consommation hors production.
258. Ajouter des recommandations de consolidation orientées énergie.
259. Ajouter un mode `coût de veille` des ressources arrêtées mais encore coûteuses.
260. Ajouter un tableau `impact énergie d’un redimensionnement`.
261. Ajouter un scénario `si je coupe ce nœud la nuit`.
262. Ajouter une vue `émissions évitées` après optimisation.
263. Ajouter une comparaison EDF vs tarif manuel vs heure pleine/creuse.
264. Ajouter une prise en charge optionnelle d’autres fournisseurs d’électricité.
265. Ajouter une vue `PUE observé dans le temps`.
266. Ajouter un indicateur de qualité des données énergétiques.
267. Ajouter une répartition `IT / PUE / abonnement / taxe` quand souhaité.
268. Ajouter une vue `saison chaude` sur delta thermique et risques.
269. Ajouter un rapport mensuel GreenIT prêt à envoyer.
270. Ajouter des objectifs énergétiques et leur suivi.
271. Ajouter un comparatif `puissance estimée vs power meter réel`.
272. Ajouter une projection annuelle glissante par mois.
273. Ajouter un budget énergie et des alertes d’écart.
274. Ajouter une vue `heures les plus coûteuses`.
275. Ajouter un mode `décision` pour arbitrer performance vs coût.

## Sécurité, RBAC et audit (276-300)

276. Ajouter des rôles personnalisables au-delà des rôles fixes.
277. Ajouter une matrice de permissions par écran et par action.
278. Ajouter des permissions ciblées par nœud ou groupe de VM.
279. Ajouter un mode `lecture audit` pour les équipes conformité.
280. Ajouter une vue `actions sensibles de la semaine`.
281. Ajouter un diff lisible des changements de configuration sensibles.
282. Ajouter une signature ou empreinte des exports d’audit.
283. Ajouter un mode `double validation` pour actions critiques.
284. Ajouter un verrouillage renforcé pour suppression VM et restore en prod.
285. Ajouter des sessions à périmètre limité par contexte.
286. Ajouter un tableau des comptes inactifs à nettoyer.
287. Ajouter une expiration configurable des comptes locaux secondaires.
288. Ajouter un journal `qui a vu quoi` sur les écrans sensibles si requis.
289. Ajouter une vue `dernière authentification par utilisateur`.
290. Ajouter un score de posture sécurité de l’app plus détaillé.
291. Ajouter des règles de mot de passe configurables finement.
292. Ajouter un support TOTP natif pour comptes locaux.
293. Ajouter des tokens d’accès applicatifs internes avec périmètre limité.
294. Ajouter un coffre intégré ou connecteur secret manager.
295. Ajouter une vue des erreurs de permission fréquentes.
296. Ajouter un mode de revue périodique des accès.
297. Ajouter une cartographie des flux sensibles internes.
298. Ajouter un export d’audit vers SIEM.
299. Ajouter une alerte sur tentatives répétées d’action refusée.
300. Ajouter un guide `durcissement production` directement depuis la page sécurité.

## Identité, connexions et accès externes (301-325)

301. Ajouter une vraie page `sources d’identité` centralisée.
302. Ajouter la prise en charge SSO OIDC pour l’interface locale.
303. Ajouter la prise en charge SAML pour les environnements entreprise.
304. Ajouter une vue `état des connexions externes` avec tests.
305. Ajouter un bouton `tester Proxmox`, `tester PBS`, `tester cloud`, `tester iLO`.
306. Ajouter une rotation guidée des secrets externes.
307. Ajouter un rappel avant expiration des certificats ou secrets.
308. Ajouter un diagnostic de reverse proxy plus explicite.
309. Ajouter une page de santé des intégrations.
310. Ajouter un assistant de configuration réseau pour accès public sécurisé.
311. Ajouter un contrôle automatique des redirect URI OAuth.
312. Ajouter un mode `broker public` plus industrialisé.
313. Ajouter la connexion Dropbox comme cible simple supplémentaire.
314. Ajouter la connexion S3 compatible pour particuliers et entreprises.
315. Ajouter un tableau `permissions OAuth demandées` par provider.
316. Ajouter une vue `tokens bientôt expirés`.
317. Ajouter un bouton `reconnecter sans casser la config`.
318. Ajouter une gestion de plusieurs comptes cloud par provider.
319. Ajouter un marquage `perso` vs `entreprise` des connecteurs cloud.
320. Ajouter une détection des providers mal configurés avant usage.
321. Ajouter une vraie aide de premier paramétrage illustrée.
322. Ajouter des modèles de config pour Synology, Wasabi, Backblaze et OVH.
323. Ajouter une option `accès délégué` pour tiers exploitant.
324. Ajouter une vue historique des erreurs de connexion par intégration.
325. Ajouter une surveillance continue des permissions iLO/Redfish insuffisantes.

## Assistant et IA (326-350)

326. Ajouter une mémoire métier structurée par cluster, VM et service.
327. Ajouter un mode `assistant opérateur` plus directif.
328. Ajouter un mode `assistant formateur` qui explique les actions.
329. Ajouter une vraie création de VM par conversation de bout en bout.
330. Ajouter des suggestions d’action proactives basées sur l’état du cluster.
331. Ajouter une synthèse quotidienne IA de la plateforme.
332. Ajouter un résumé automatique après incident ou backup raté.
333. Ajouter des explications naturelles sur les graphes.
334. Ajouter un assistant de diagnostic réseau invité.
335. Ajouter un assistant de diagnostic backup.
336. Ajouter un assistant de diagnostic performances stockage.
337. Ajouter une génération de runbook depuis l’état réel de l’app.
338. Ajouter une génération de changelog exploitation hebdomadaire.
339. Ajouter un mode `question libre` qui sait répondre sans pousser au wizard.
340. Ajouter un mode `fais-le pour moi` avec approbation finale.
341. Ajouter un historique des conversations lié aux ressources.
342. Ajouter la possibilité d’épingler des réponses IA utiles.
343. Ajouter des suggestions d’actions après lecture d’une fiche VM.
344. Ajouter un assistant de sizing initial et de re-sizing.
345. Ajouter un mode vocal local si l’utilisateur le souhaite.
346. Ajouter des réponses contextualisées au rôle utilisateur.
347. Ajouter un mode `résume-moi ce qui a changé depuis hier`.
348. Ajouter la génération automatique de ticket ou message Slack/Teams.
349. Ajouter une base de connaissances auto-alimentée depuis les journaux.
350. Ajouter un garde-fou `ne jamais agir sans montrer le plan`.

## Reporting, exports et connaissance (351-375)

351. Ajouter un centre de rapports prêt à l’emploi.
352. Ajouter des rapports hebdomadaires d’exploitation automatiques.
353. Ajouter des rapports mensuels de capacité.
354. Ajouter des rapports de conformité backup.
355. Ajouter des rapports GreenIT exportables en PDF propre.
356. Ajouter un rapport sécurité mensuel.
357. Ajouter un rapport `incidents et indisponibilités`.
358. Ajouter des exports CSV multi-sections dans un même bundle.
359. Ajouter un mode export JSON complet pour API ou BI externe.
360. Ajouter une bibliothèque de modèles de rapport.
361. Ajouter des rapports comparatifs mois N vs N-1.
362. Ajouter un espace `notes d’exploitation`.
363. Ajouter une wiki interne légère liée aux ressources.
364. Ajouter des checklists versionnées.
365. Ajouter un journal de bord opérateur par jour.
366. Ajouter une timeline consolidée de tous les événements majeurs.
367. Ajouter un export `dossier VM` complet en un clic.
368. Ajouter un export `dossier cluster` complet en un clic.
369. Ajouter des signatures temporelles sur les exports importants.
370. Ajouter un lien direct entre rapport et écran source.
371. Ajouter un mode `rapport de réunion` automatique.
372. Ajouter un export image HD des graphes.
373. Ajouter la personnalisation du branding des exports.
374. Ajouter des rapports filtrés par projet/client.
375. Ajouter une recherche globale dans les rapports archivés.

## Notifications, mobile et collaboration (376-400)

376. Ajouter un centre de notifications unifié dans l’application.
377. Ajouter des notifications persistantes jusqu’à acquittement.
378. Ajouter des priorités de notification configurables.
379. Ajouter un digest quotidien ou hebdomadaire.
380. Ajouter l’envoi vers Slack.
381. Ajouter l’envoi vers Microsoft Teams.
382. Ajouter l’envoi vers email avec gabarits propres.
383. Ajouter l’envoi vers webhook générique.
384. Ajouter des abonnements par type d’événement.
385. Ajouter des abonnements par VM, nœud ou plan backup.
386. Ajouter un mode mobile `lecture seule` ultra lisible.
387. Ajouter des cartes mobiles simplifiées pour les métriques.
388. Ajouter un mode PWA installable.
389. Ajouter le support des push notifications navigateur.
390. Ajouter une vue `astreinte` concentrée sur les urgences.
391. Ajouter des accusés de prise en charge sur les alertes.
392. Ajouter un journal d’escalade incident.
393. Ajouter la mention d’un collègue dans une note ou un incident.
394. Ajouter un partage de vue filtrée à un autre utilisateur.
395. Ajouter des statuts de travail `vu`, `en cours`, `résolu`.
396. Ajouter des tâches d’exploitation légères dans l’outil.
397. Ajouter un mode commentaire sur les événements majeurs.
398. Ajouter une file de travail personnelle.
399. Ajouter une vue `ce qui attend mon action`.
400. Ajouter un bandeau `handover` entre équipes jour/nuit.

## Multi-cluster, API et intégrations (401-425)

401. Ajouter la gestion de plusieurs clusters Proxmox dans une seule interface.
402. Ajouter une vue consolidée multi-sites.
403. Ajouter des rôles et permissions par cluster.
404. Ajouter des filtres croisés multi-clusters.
405. Ajouter un comparateur de santé entre clusters.
406. Ajouter une API publique documentée de l’application.
407. Ajouter des webhooks sortants sur événements majeurs.
408. Ajouter des webhooks entrants pour enrichir le journal.
409. Ajouter une intégration Prometheus export native.
410. Ajouter une intégration Grafana avec liens profonds.
411. Ajouter une intégration Loki/ELK pour les journaux.
412. Ajouter une intégration ticketing Jira/GLPI/ServiceNow.
413. Ajouter une intégration CMDB simple.
414. Ajouter une intégration NetBox pour le réseau et l’inventaire.
415. Ajouter une intégration Vault pour les secrets.
416. Ajouter une intégration GitOps pour certaines configurations.
417. Ajouter une intégration Terraform plan/apply supervisée.
418. Ajouter une intégration Ansible pour post-provisioning.
419. Ajouter une importation automatique d’étiquettes depuis systèmes tiers.
420. Ajouter un plugin system pour providers tiers.
421. Ajouter des extensions de panneaux via API interne.
422. Ajouter une fédération d’événements multi-outils.
423. Ajouter un SDK TypeScript pour scripts externes.
424. Ajouter un SDK Python pour automatisations internes.
425. Ajouter un mode `lab` pour tester de nouveaux connecteurs.

## DevEx, QA et qualité produit (426-450)

426. Ajouter une vraie suite smoke browser en CI sur les écrans critiques.
427. Ajouter des tests visuels de non-régression par capture.
428. Ajouter une matrice de tests responsive desktop/tablette/mobile.
429. Ajouter une vérification automatique d’accessibilité en CI.
430. Ajouter une vérification automatique des textes manquants ou mixtes FR/EN.
431. Ajouter une stratégie de feature flags propre.
432. Ajouter une page interne `diagnostic build` pour debug prod.
433. Ajouter des fixtures Proxmox et Redfish plus complètes.
434. Ajouter un mode démo avec données cohérentes riches.
435. Ajouter un environnement de staging intégré dans la doc.
436. Ajouter un script de seed pour clusters de démonstration.
437. Ajouter des tests de montée en charge sur gros inventaires.
438. Ajouter un profiler interne sur les routes lentes.
439. Ajouter une mesure de Web Vitals côté UI.
440. Ajouter un rapport de dette UX par release.
441. Ajouter un changelog utilisateur plus lisible.
442. Ajouter un système de migration de configs versionné.
443. Ajouter un centre `expériences bêta`.
444. Ajouter des tests de permissions systématiques par rôle.
445. Ajouter des contrats JSON pour les routes API internes.
446. Ajouter des snapshots unitaires pour les composants de graphes.
447. Ajouter un validateur automatique des pages d’erreur.
448. Ajouter un vérificateur de cohérence des styles globaux.
449. Ajouter un audit de performance bundle par écran.
450. Ajouter une checklist de release automatisée.

## Installation, mise à jour et exploitation (451-475)

451. Ajouter un installateur interactif TUI côté serveur.
452. Ajouter une vérification pré-installation plus détaillée.
453. Ajouter un mode `diagnostic update` en un clic.
454. Ajouter un rollback automatique de version après update ratée.
455. Ajouter un aperçu de la version à appliquer avant update.
456. Ajouter un changelog embarqué lié à la version détectée.
457. Ajouter une page `santé de l’installation`.
458. Ajouter une vérification du montage Docker socket plus claire.
459. Ajouter une détection de compose/service plus robuste sur environnements atypiques.
460. Ajouter une mise à jour différée planifiable.
461. Ajouter une fenêtre de maintenance paramétrable pour les updates.
462. Ajouter des sauvegardes de config avant chaque update.
463. Ajouter une vérification de compatibilité version Proxmox ↔ ProxmoxCenter.
464. Ajouter une vue des dépendances système requises.
465. Ajouter un pack d’export support technique anonymisable.
466. Ajouter un assistant `reverse proxy` pas à pas.
467. Ajouter une vérification de sécurité post-installation.
468. Ajouter une détection de ports et conflits fréquents.
469. Ajouter une doc intégrée pour Docker, LXC et VM d’installation.
470. Ajouter un mode mise à jour offline via bundle.
471. Ajouter un canal stable et un canal bêta.
472. Ajouter une vérification automatique de l’espace disque avant update.
473. Ajouter une reprise d’update interrompue.
474. Ajouter un historique des versions appliquées.
475. Ajouter une page `quoi faire si l’update échoue`.

## Produit, gouvernance et nouveaux usages (476-500)

476. Ajouter des workspaces multi-clients avec branding léger.
477. Ajouter une facturation interne par projet selon ressources utilisées.
478. Ajouter une refacturation énergétique par entité.
479. Ajouter un tableau de bord direction différent du tableau opérateur.
480. Ajouter des objectifs mensuels et KPI métier.
481. Ajouter une vue `coût complet de possession` par workload.
482. Ajouter une bibliothèque de politiques d’entreprise réutilisables.
483. Ajouter un système de labels conformité `critique`, `RGPD`, `interne`.
484. Ajouter des campagnes de nettoyage saisonnières guidées.
485. Ajouter un mode onboarding nouvel opérateur.
486. Ajouter des parcours de démonstration pour avant-vente.
487. Ajouter une édition communautaire et des modules optionnels.
488. Ajouter un système de feedback produit centralisé.
489. Ajouter des votes internes sur les idées backlog.
490. Ajouter un scoring `valeur / effort / risque` sur chaque idée.
491. Ajouter une roadmap publique générée depuis ce backlog.
492. Ajouter des modèles de politiques backup/sécurité/énergie.
493. Ajouter un mode MSP avec séparation forte des périmètres.
494. Ajouter des dossiers ou portfolios de services.
495. Ajouter un centre `coûts & valeur` pour arbitrer les choix infra.
496. Ajouter une analyse `qu’est-ce que je peux décommissionner`.
497. Ajouter une cartographie des dépendances applicatives entre VM.
498. Ajouter une vue `business impact` pour chaque alerte majeure.
499. Ajouter un moteur de priorisation automatique du backlog produit.
500. Ajouter une roadmap trimestrielle suggérée automatiquement à partir des données réelles du produit.
