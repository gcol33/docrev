/**
 * Common scientific and academic words not in standard dictionaries
 * These words are accepted by Word's spellchecker
 */

export const scientificWords = new Set([
  // Biology/Ecology
  'abiotic', 'biotic', 'biogeographic', 'biogeography', 'phenotypic', 'phenotype',
  'anthropogenic', 'propagule', 'propagules', 'herbivory', 'herbivore', 'herbivores',
  'ruderal', 'ruderals', 'refugia', 'refugium', 'hotspot', 'hotspots',
  'biodiversity', 'ecosystem', 'ecosystems', 'ecotype', 'ecotypes',
  'taxonomic', 'phylogenetic', 'phylogeny', 'morphological', 'morphology',
  'allometric', 'allometry', 'biomass', 'biome', 'biomes',
  'invasibility', 'invasive', 'invasives', 'neophyte', 'neophytes',
  'archaeophyte', 'archaeophytes', 'naturalisation', 'naturalization',
  'colonisation', 'colonization', 'dispersal', 'fecundity',
  'phenology', 'phenological', 'ontogeny', 'ontogenetic',
  'mesic', 'xeric', 'hydric', 'riparian', 'riverine',
  'subalpine', 'alpine', 'boreal', 'temperate', 'tropical',
  'heathland', 'heathlands', 'scrubland', 'scrublands', 'grassland', 'grasslands',
  'broadleaf', 'broadleaved', 'coniferous', 'deciduous', 'evergreen',
  'autochory', 'autochorous', 'zoochory', 'zoochorous',
  'anemochory', 'anemochorous', 'hydrochory', 'hydrochorous',
  'anthropochory', 'anthropochorous', 'hemerochor', 'hemerochorist',
  'helophyte', 'helophytes', 'hydrophyte', 'hydrophytes',
  'therophyte', 'therophytes', 'geophyte', 'geophytes',
  'chamaephyte', 'chamaephytes', 'phanerophyte', 'phanerophytes',

  // Statistics
  'logit', 'logistic', 'probit', 'frequentist', 'bayesian',
  'overdispersion', 'underdispersion', 'heteroscedasticity', 'homoscedasticity',
  'multicollinearity', 'autocorrelation', 'covariate', 'covariates',
  'parameterization', 'parameterisation', 'reparameterization',
  'bootstrapping', 'resampling', 'imputation', 'interpolation',
  'standardized', 'standardised', 'normalized', 'normalised',
  'discretized', 'discretised', 'categorized', 'categorised',

  // Compound words
  'overrepresentation', 'underrepresentation', 'overrepresented', 'underrepresented',
  'outcompete', 'outcompetes', 'outcompeted', 'outcompeting',
  'subdataset', 'subgroup', 'subgroups', 'subtype', 'subtypes',
  'dataset', 'datasets', 'datapoint', 'datapoints',
  'spatiotemporal', 'spatio', 'geospatial',
  'timestep', 'timesteps', 'timeframe', 'timeframes',
  'warmup', 'backend', 'frontend', 'workflow', 'workflows',
  'fallback', 'fallbacks', 'tradeoff', 'tradeoffs',

  // Academic writing
  'interpretability', 'reproducibility', 'replicability',
  'hypothesise', 'hypothesised', 'hypothesize', 'hypothesized',
  'analyse', 'analysed', 'analyze', 'analyzed',
  'prioritise', 'prioritised', 'prioritize', 'prioritized',
  'characterise', 'characterised', 'characterize', 'characterized',
  'generalise', 'generalised', 'generalize', 'generalized',
  'parameterise', 'parameterised', 'parameterize', 'parameterized',
  'visualise', 'visualised', 'visualize', 'visualized',
  'modelling', 'modeling', 'modelled', 'modeled',

  // Geography
  'unvegetated', 'landform', 'landforms', 'topographic', 'topography',
  'elevational', 'latitudinal', 'longitudinal', 'altitudinal',

  // Technical
  'doi', 'dois', 'pdf', 'pdfs', 'csv', 'xlsx',
  'pandoc', 'markdown', 'bibtex', 'crossref',

  // R packages and tools
  'brms', 'cmdstanr', 'rstanarm', 'lme', 'glmm', 'glmer', 'lmer',
  'ggplot', 'dplyr', 'tidyr', 'tidyverse', 'rmarkdown',

  // Common in papers
  'foci', 'et', 'al', 'cf', 'eg', 'ie', 'vs',
]);
