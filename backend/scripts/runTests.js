import { execSync } from 'child_process';

const testFiles = [
  'test/api.test.js',
  'test/chat.test.js',
  'test/writeActions.test.js',
  'test/genericEntities.test.js',
  'test/jobMonitoring.test.js',
  'test/idocMonitoring.test.js',
  'test/interfaceMonitoring.test.js',
  'test/realSapIntegration.test.js',
  'test/sensitiveActions.test.js',
  'test/multiSystem.test.js',
  'test/knowledgeBase.test.js',
  'test/bomChatFix.test.js',
  'test/structuredBomForms.test.js',
  'test/sourceBomValidation.test.js',
  'test/sapSessionMonitoring.test.js',
  'test/deleteBomVerification.test.js',
  'test/sapMultiSession.test.js',
  'test/bomStructuralPreservation.test.js',
  'test/bomDiscrepancyFixes.test.js',
  'test/crossPlantAlternativeFix.test.js',
  'test/vbsSyntaxValidation.test.js'
];

const env = {
  ...process.env,
  USE_MOCK_SAP: 'true'
};

for (const file of testFiles) {
  try {
    execSync(`node ${file}`, { env, stdio: 'inherit' });
  } catch (err) {
    process.exit(err.status || 1);
  }
}
