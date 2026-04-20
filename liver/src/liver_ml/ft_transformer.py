"""Feature Tokenizer Transformer (FT-Transformer) 二分类，PyTorch。

文献中的 TabTransformer 与 FT-Transformer 均属「表格特征嵌入 + Transformer」；
此处实现 FT-Transformer（Feature Tokenizer 结构）。若需经典 TabTransformer，
可在此基础上改为列嵌入后仅接 Transformer 编码器，接口保持一致。
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import OrdinalEncoder
from torch.utils.data import DataLoader, TensorDataset

from .metrics_tools import classification_metrics


class _FTBlock(nn.Module):
    def __init__(self, d: int, n_heads: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(d)
        self.attn = nn.MultiheadAttention(d, n_heads, dropout=dropout, batch_first=True)
        self.ln2 = nn.LayerNorm(d)
        self.ff = nn.Sequential(
            nn.Linear(d, 4 * d),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(4 * d, d),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.ln1(x)
        a, _ = self.attn(h, h, h, need_weights=False)
        x = x + a
        h = self.ln2(x)
        x = x + self.ff(h)
        return x


class FTTransformerClassifier(nn.Module):
    """数值列线性投影 + 类别列嵌入 + CLS + Transformer + 二分类头。"""

    def __init__(
        self,
        n_num: int,
        cat_cards: list[int],
        d_model: int = 96,
        n_layers: int = 3,
        n_heads: int = 4,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.n_num = n_num
        self.n_cat = len(cat_cards)
        self.num_proj = nn.ModuleList([nn.Linear(1, d_model) for _ in range(n_num)])
        self.cat_emb = nn.ModuleList([nn.Embedding(int(c), d_model, padding_idx=0) for c in cat_cards])
        n_tokens = 1 + n_num + self.n_cat
        self.cls_token = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)
        self.pos = nn.Parameter(torch.randn(1, n_tokens, d_model) * 0.02)
        self.blocks = nn.ModuleList([_FTBlock(d_model, n_heads, dropout) for _ in range(n_layers)])
        self.ln_f = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, 1)

    def forward(self, x_num: torch.Tensor, x_cat: torch.Tensor) -> torch.Tensor:
        b = x_num.size(0)
        x_num = torch.nan_to_num(x_num, nan=0.0)
        parts = [self.num_proj[i](x_num[:, i : i + 1]).unsqueeze(1) for i in range(self.n_num)]
        for i in range(self.n_cat):
            parts.append(self.cat_emb[i](x_cat[:, i].clamp(max=self.cat_emb[i].num_embeddings - 1)).unsqueeze(1))
        x = torch.cat(parts, dim=1)
        cls = self.cls_token.expand(b, -1, -1)
        x = torch.cat([cls, x], dim=1)
        x = x + self.pos[:, : x.size(1)]
        for blk in self.blocks:
            x = blk(x)
        x = self.ln_f(x[:, 0])
        return self.head(x).squeeze(-1)


def _encode_cat(X: pd.DataFrame, cat_cols: list[str], enc: OrdinalEncoder | None, fit: bool):
    if not cat_cols:
        return np.zeros((len(X), 0), dtype=np.int64), enc
    raw = X[cat_cols].astype(str).fillna("nan")
    if fit:
        enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1, encoded_missing_value=-1)
        C = enc.fit_transform(raw)
    else:
        C = enc.transform(raw)
    C = np.where(C < 0, 0, C + 1).astype(np.int64)
    return C, enc


def _impute_num(X_tr: pd.DataFrame, X_va: pd.DataFrame, num_cols: list[str]):
    Xn_tr = X_tr[num_cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float32)
    Xn_va = X_va[num_cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float32)
    med = np.nanmedian(Xn_tr, axis=0)
    med = np.where(np.isnan(med), 0.0, med)
    Xn_tr = np.where(np.isnan(Xn_tr), med, Xn_tr)
    Xn_va = np.where(np.isnan(Xn_va), med, Xn_va)
    return Xn_tr, Xn_va, med


def train_ft_transformer(
    X_train: pd.DataFrame,
    X_val: pd.DataFrame,
    y_train: pd.Series,
    y_val: pd.Series,
    num_cols: list[str],
    cat_cols: list[str],
    device: str | None = None,
    epochs: int = 80,
    batch_size: int = 128,
    lr: float = 1e-3,
    seed: int = 42,
) -> tuple[dict, FTTransformerClassifier | None, OrdinalEncoder | None, np.ndarray]:
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(seed)
    np.random.seed(seed)

    Xn_tr, Xn_va, med = _impute_num(X_train, X_val, num_cols)
    C_tr, enc = _encode_cat(X_train, cat_cols, None, fit=True)
    C_va, _ = _encode_cat(X_val, cat_cols, enc, fit=False)

    # 每列类别数（含 padding 0）
    cards = [int(C_tr[:, j].max()) + 1 for j in range(C_tr.shape[1])] if C_tr.shape[1] else []

    model = FTTransformerClassifier(
        n_num=len(num_cols),
        cat_cards=cards,
        d_model=96,
        n_layers=3,
        n_heads=4,
        dropout=0.15,
    ).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)

    def forward_batch(xn: torch.Tensor, xc: torch.Tensor) -> torch.Tensor:
        if xc.size(1) == 0:
            return model(xn, torch.zeros(xn.size(0), 0, dtype=torch.long, device=xn.device))
        return model(xn, xc)

    train_loader = DataLoader(
        TensorDataset(
            torch.tensor(Xn_tr, dtype=torch.float32),
            torch.tensor(C_tr, dtype=torch.long) if C_tr.size else torch.zeros(len(Xn_tr), 0, dtype=torch.long),
            torch.tensor(y_train.values, dtype=torch.float32),
        ),
        batch_size=batch_size,
        shuffle=True,
    )
    val_loader = DataLoader(
        TensorDataset(
            torch.tensor(Xn_va, dtype=torch.float32),
            torch.tensor(C_va, dtype=torch.long) if C_va.size else torch.zeros(len(Xn_va), 0, dtype=torch.long),
            torch.tensor(y_val.values, dtype=torch.float32),
        ),
        batch_size=batch_size,
        shuffle=False,
    )

    best_auc = 0.0
    best_state = None
    epoch_log: list[dict] = []
    for ep in range(1, epochs + 1):
        model.train()
        tr_losses = []
        for xn, xc, yb in train_loader:
            xn = xn.to(device)
            xc = xc.to(device)
            yb = yb.to(device)
            opt.zero_grad()
            logits = forward_batch(xn, xc)
            loss = nn.functional.binary_cross_entropy_with_logits(logits, yb)
            loss.backward()
            opt.step()
            tr_losses.append(float(loss.detach().cpu().item()))
        model.eval()
        preds = []
        with torch.no_grad():
            for xn, xc, _ in val_loader:
                xn = xn.to(device)
                xc = xc.to(device)
                logits = forward_batch(xn, xc)
                preds.append(torch.sigmoid(logits).cpu().numpy())
        p_va = np.concatenate(preds)
        from sklearn.metrics import roc_auc_score

        yv = y_val.to_numpy() if hasattr(y_val, "to_numpy") else np.asarray(y_val)
        auc = roc_auc_score(yv, p_va) if len(np.unique(yv)) > 1 else 0.0
        m0 = yv == 0
        m1 = yv == 1
        mean_p_neg = float(np.mean(p_va[m0])) if np.any(m0) else float("nan")
        mean_p_pos = float(np.mean(p_va[m1])) if np.any(m1) else float("nan")
        ent = -(p_va * np.log(p_va + 1e-12) + (1 - p_va) * np.log(1 - p_va + 1e-12))
        epoch_log.append(
            {
                "epoch": ep,
                "train_loss_mean": float(np.mean(tr_losses)) if tr_losses else float("nan"),
                "val_auc": float(auc),
                "val_mean_prob_y0": mean_p_neg,
                "val_mean_prob_y1": mean_p_pos,
                "val_mean_entropy": float(np.mean(ent)),
            }
        )
        if auc >= best_auc:
            best_auc = auc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
    if best_state:
        model.load_state_dict(best_state)

    model.eval()
    with torch.no_grad():
        xn = torch.tensor(Xn_va, dtype=torch.float32, device=device)
        xc = torch.tensor(C_va, dtype=torch.long, device=device) if C_va.size else torch.zeros(len(Xn_va), 0, dtype=torch.long, device=device)
        p_va = torch.sigmoid(forward_batch(xn, xc)).cpu().numpy()

    metrics_val = classification_metrics(y_val, p_va)
    return (
        {
            "val": metrics_val,
            "device": device,
            "auc_best": best_auc,
            "epoch_confidence_log": pd.DataFrame(epoch_log),
            "val_probs": np.asarray(p_va, dtype=float),
        },
        model,
        enc,
        med,
    )


def evaluate_ft_test(
    model: FTTransformerClassifier,
    enc: OrdinalEncoder | None,
    med: np.ndarray,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    num_cols: list[str],
    cat_cols: list[str],
    device: str,
) -> tuple[dict, np.ndarray]:
    Xn_te = X_test[num_cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float32)
    Xn_te = np.where(np.isnan(Xn_te), med, Xn_te)
    if cat_cols and enc is not None:
        C_te, _ = _encode_cat(X_test, cat_cols, enc, fit=False)
    else:
        C_te = np.zeros((len(X_test), 0), dtype=np.int64)

    xn = torch.tensor(Xn_te, dtype=torch.float32, device=device)
    xc = torch.tensor(C_te, dtype=torch.long, device=device) if C_te.size else torch.zeros(len(X_test), 0, dtype=torch.long, device=device)

    model.eval()
    with torch.no_grad():
        if xc.size(1) == 0:
            logits = model(xn, torch.zeros(xn.size(0), 0, dtype=torch.long, device=device))
        else:
            logits = model(xn, xc)
        p_te = torch.sigmoid(logits).cpu().numpy()
    return classification_metrics(y_test, p_te), p_te
