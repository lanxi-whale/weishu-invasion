import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScenario, scenariosOf } from '../game/tools/golden.mjs';
import { getData } from '../game_ops/server/data.js';
import { buildDeployMap, canPlace, positionClass } from '../game_ops/server/match/board.js';

test('the roster baseline deploys operators on the official m04 arena', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const scenario = scenariosOf('roster').find(({ stageId }) => stageId === 'act3autochess_m04');
  assert.ok(scenario, 'the official m04 arena remains covered');
  const deployMap = buildDeployMap(data.stages[scenario.stageId]);
  const operators = scenario.players.flatMap(({ units }) => units).filter(({ kind }) => kind === 'chess');
  assert.ok(operators.length > 0);
  for (const { chessId, row, col } of operators) {
    assert.ok(data.chess[chessId], `${chessId} belongs to the defender roster`);
    assert.ok(canPlace(deployMap, positionClass(data.chess[chessId]), row, col), `${chessId} fits at ${row},${col}`);
  }
  const result = runScenario(scenario);
  assert.equal(result.errors.count, 0);
  assert.ok(result.ticks > 0);
});
