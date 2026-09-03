import type {
  NflPositionMarketGroup,
  NflSellerMoveOptionsResponse,
  NflSellerMoveRequest,
  NflSellerMoveResponse,
} from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function getNflSellerMoveOptions(
  teamId: string,
  positionGroups: NflPositionMarketGroup[],
): Promise<NflSellerMoveOptionsResponse> {
  const params = new URLSearchParams({
    team_id: teamId,
    position_groups: positionGroups.join(','),
  });
  const response = await fetch(`${SERVER_URL}/nfl/transaction-market/move-options?${params}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Could not load current Giants contracts (${response.status})${body ? `: ${body}` : ''}`);
  }
  const body = await response.json() as NflSellerMoveOptionsResponse;
  return body;
}

export function modelNflSellerMove(request: NflSellerMoveRequest): Promise<NflSellerMoveResponse> {
  return postJson('/nfl/transaction-market/model-move', request);
}
