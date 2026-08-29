import os
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import least_squares
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

OUT = os.path.join(os.path.dirname(__file__), "analysis_output")
os.makedirs(OUT, exist_ok=True)

END = 10.0
REL_ERR = 0.21
MIN_KEEP = 0.80
BOOTSTRAPS = 2000

def read_sessions(base):
    paths = [os.path.join(base, f"측정데이터{i}.xlsx") for i in (1, 2, 3)]
    d1 = pd.read_excel(paths[0], header=None)
    sessions = {}
    # Session 1: time, value, person
    sessions[1] = [{"person": str(p), "time": t, "value": v}
                   for t, v, p in zip(d1.iloc[1:, 0], d1.iloc[1:, 1], d1.iloc[1:, 2])
                   if pd.notna(t) and pd.notna(v) and pd.notna(p)]
    for sn in (2, 3):
        d = pd.read_excel(paths[sn-1], header=None)
        rows = []
        for c in (0, 3):
            for t, p, v in zip(d.iloc[1:, c], d.iloc[1:, c+1], d.iloc[1:, c+2]):
                if pd.notna(t) and pd.notna(v) and pd.notna(p):
                    rows.append({"person": str(p), "time": t, "value": float(v)})
        sessions[sn] = rows
    return sessions

def normalise(rows):
    # Each person's maximum observed sample is treated as peak and local t=0.
    out = []
    for person in sorted(set(r["person"] for r in rows)):
        x = [r for r in rows if r["person"] == person]
        x.sort(key=lambda r: r["time"])
        peak=max(x,key=lambda r: float(r["value"]))
        t0 = peak["time"]
        def minutes(t):
            return (t.hour*60 + t.minute + t.second/60) - (t0.hour*60 + t0.minute + t0.second/60)
        out += [{"person": person, "t": minutes(r["time"]), "C": float(r["value"])} for r in x]
    return pd.DataFrame(out)

def fit_exp(df):
    sigma = np.maximum(1.0, REL_ERR*np.abs(df.C.to_numpy()))
    t, y = df.t.to_numpy(float), df.C.to_numpy(float)
    C0=float(max(y))
    def residual(z):
        k = np.exp(z[0])
        return (y - C0*np.exp(-k*t))/sigma
    res = least_squares(residual, np.log([.005]), max_nfev=2000)
    k=float(np.exp(res.x[0]))
    pred = C0*np.exp(-k*t)
    return C0, k, pred, sigma

def preprocess(df):
    # The first maximum is C0/t=0; absorption points before it never participate.
    work = df[df.t >= 0].copy().reset_index(drop=True)
    C0, k, pred, sigma = fit_exp(work)
    rel = np.abs(work.C.to_numpy()-pred)/sigma
    work["initial_rel_error"] = rel
    work["status"] = np.where(rel <= 1, "included", "excluded_>21%")
    keep = np.where(rel <= 1)[0].tolist()
    min_n = int(np.ceil(MIN_KEEP*len(work)))
    if len(keep) < min_n:
        excluded = [i for i in np.argsort(rel) if i not in keep]
        keep += excluded[:min_n-len(keep)]
    work.loc[work.index.isin(keep) & (work.status == "excluded_>21%"), "status"] = "re-included_to_80%"
    final = work.iloc[sorted(keep)].copy()
    return final, work

def k21(df, C0):
    lo, hi = [], []
    for t, c in zip(df.t, df.C):
        if t <= 0: continue
        s = max(1.0, REL_ERR*abs(c))
        lower = max(0.0, np.log(C0/(c+s))/t)
        upper = np.inf if c-s <= 0 else np.log(C0/(c-s))/t
        lo.append(lower); hi.append(upper)
    return (max(lo), min(hi)) if lo else (np.nan, np.nan)

def k21_intervals(df, C0):
    rows = []
    for index, row in df.reset_index(drop=True).iterrows():
        if row.t <= 0:
            continue
        sigma = max(1.0, REL_ERR*abs(row.C))
        low = max(0.0, np.log(C0/(row.C+sigma))/row.t)
        high = np.inf if row.C-sigma <= 0 else np.log(C0/(row.C-sigma))/row.t
        rows.append({"point": index, "minutes": row.t, "C": row.C, "k_low": low, "k_high": high})
    return pd.DataFrame(rows)

def plot_k21_intervals(intervals, central_k, filename):
    finite = intervals[np.isfinite(intervals.k_high)].copy()
    plt.figure(figsize=(10, 6)); ax = plt.gca()
    for y, row in finite.reset_index(drop=True).iterrows():
        ax.hlines(y, row.k_low, row.k_high, color="#1769aa", linewidth=3)
        ax.plot([row.k_low, row.k_high], [y, y], "|", color="#1769aa", markersize=9)
    joint_low = float(finite.k_low.max()) if not finite.empty else np.nan
    joint_high = float(finite.k_high.min()) if not finite.empty else np.nan
    if np.isfinite(joint_low) and np.isfinite(joint_high) and joint_low <= joint_high:
        ax.axvspan(joint_low, joint_high, color="#f2b134", alpha=.25, label=f"K21 intersection {joint_low:.6f}~{joint_high:.6f}")
    else:
        ax.text(.98, .03, "K21 intersection: empty", transform=ax.transAxes, ha="right", color="#d62728")
    ax.axvline(central_k, color="black", linestyle="--", label=f"fitted k={central_k:.6f}/min")
    ax.set(xlabel="compatible k (/min)", ylabel="retained point", title="Per-point K21 compatible intervals")
    ax.set_yticks(range(len(finite)), [f"{row.minutes:.0f} min · C={row.C:g}" for row in finite.itertuples()])
    ax.grid(axis="x", alpha=.2); ax.legend(fontsize=8); plt.tight_layout(); plt.savefig(filename, dpi=180); plt.close()

def r2_rmse(df, C0, k):
    y = df.C.to_numpy(float); p = C0*np.exp(-k*df.t.to_numpy(float))
    return 1-np.sum((y-p)**2)/np.sum((y-y.mean())**2), np.sqrt(np.mean((y-p)**2))

def k95(df, C0, k, sigma, seed=20260829):
    rng = np.random.default_rng(seed)
    t, y = df.t.to_numpy(float), df.C.to_numpy(float)
    ks = []
    z = (y-C0*np.exp(-k*t))/sigma
    z = z - z.mean()
    for _ in range(BOOTSTRAPS):
        ys = C0*np.exp(-k*t) + sigma*rng.choice(z, size=len(z), replace=True)
        b = pd.DataFrame({"t":t,"C":np.maximum(ys, 0.001)})
        ks.append(fit_exp(b)[1])
    return float(np.quantile(ks,.025)), float(np.quantile(ks,.975))

def plot_session(df, used, C0, k, k21v, k95v, title, filename):
    # Error-bar plot for the requested +/-21% measurement uncertainty.
    if filename.lower().endswith('.png'):
        plt.figure(figsize=(10,6)); ax=plt.gca()
        colors={"included":"#1769aa","excluded_>21%":"#d62728","re-included_to_80%":"#999999"}
        for status,g in df.groupby('status'):
            err=np.maximum(1.0,REL_ERR*np.abs(g.C.to_numpy(float)))
            ax.errorbar(g.t,g.C,yerr=err,fmt='o',ms=4,c=colors[status],ecolor=colors[status],capsize=2,label=status)
        grid=np.linspace(0,max(float(df.t.max()),1)+20,400)
        ax.plot(grid,C0*np.exp(-k*grid),'k-',lw=2,label=f'fit C0={C0:.2f}, k={k:.6f}/min')
        if np.isfinite(k21v[0]) and k21v[1]>k21v[0]: ax.fill_between(grid,C0*np.exp(-k21v[1]*grid),C0*np.exp(-k21v[0]*grid),color='#f2b134',alpha=.25,label='21% compatible k area')
        ax.axhline(END,color='#555',ls='--',label='C_end=10'); ax.set(xlabel='minutes from peak',ylabel='alcohol measurement',title=title); ax.grid(alpha=.2); ax.legend(fontsize=8); plt.tight_layout(); plt.savefig(filename,dpi=180); plt.close(); return
    # SVG fallback.
    W,H,L,T,R,B=1000,620,80,55,25,70; xmax=max(float(df.t.max()),1)+20; ymax=max(float(df.C.max()),END)*1.1
    def X(x): return L+(x/xmax)*(W-L-R)
    def Y(y): return H-B-(y/ymax)*(H-T-B)
    s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"><rect width="100%" height="100%" fill="white"/><text x="{L}" y="28" font-size="20">{title}</text>']
    if np.isfinite(k21v[0]) and k21v[1]>k21v[0]:
        pts=[]
        for x in np.linspace(0,xmax,100): pts.append(f'{X(x):.1f},{Y(C0*np.exp(-k21v[0]*x)):.1f}')
        for x in np.linspace(xmax,0,100): pts.append(f'{X(x):.1f},{Y(C0*np.exp(-k21v[1]*x)):.1f}')
        s.append(f'<polygon points="{" ".join(pts)}" fill="#f2b134" opacity=".25"/>')
    line=' '.join(f'{X(x):.1f},{Y(C0*np.exp(-k*x)):.1f}' for x in np.linspace(0,xmax,200)); s.append(f'<polyline points="{line}" fill="none" stroke="black" stroke-width="3"/>')
    colors={"included":"#1769aa","excluded_>21%":"#d62728","re-included_to_80%":"#999999"}
    for _,r in df.iterrows(): s.append(f'<circle cx="{X(r.t):.1f}" cy="{Y(r.C):.1f}" r="4" fill="{colors[r.status]}"/>')
    s += [f'<line x1="{L}" y1="{Y(END):.1f}" x2="{W-R}" y2="{Y(END):.1f}" stroke="#555" stroke-dasharray="6,4"/>',f'<line x1="{L}" y1="{T}" x2="{L}" y2="{H-B}" stroke="black"/><line x1="{L}" y1="{H-B}" x2="{W-R}" y2="{H-B}" stroke="black"/>',f'<text x="{L}" y="{H-25}">minutes from first sample</text><text x="10" y="{T}" transform="rotate(-90 10,{T})">alcohol</text><text x="{W-330}" y="35" fill="#1769aa">● included</text><text x="{W-220}" y="35" fill="#d62728">● excluded</text><text x="{W-120}" y="35" fill="#999">● re-included</text></svg>']
    with open(filename,'w',encoding='utf-8') as f:f.write(''.join(s))

def main():
    parser = argparse.ArgumentParser(description="Analyze Drunksafe alcohol measurement sessions")
    parser.add_argument(
        "--input-dir",
        default=str(Path.home() / "Documents" / "카카오톡 받은 파일"),
        help="directory containing 측정데이터1.xlsx through 측정데이터3.xlsx",
    )
    args = parser.parse_args()
    sessions=read_sessions(args.input_dir); d1=normalise(sessions[1]);
    target='김재영'
    d1=d1[d1.person == target].copy()
    used, tagged=preprocess(d1)
    C0,k,_,sigma=fit_exp(used); k21v=k21(used,C0); k95v=k95(used,C0,k,np.maximum(1,REL_ERR*used.C.to_numpy()))
    records=[]
    r2,rmse=r2_rmse(used,C0,k)
    joint_low=max(k21v[0],k95v[0]); joint_high=min(k21v[1],k95v[1])
    joint_valid=np.isfinite(joint_low) and np.isfinite(joint_high) and joint_low <= joint_high and joint_low <= k <= joint_high
    applied=(joint_low,joint_high) if joint_valid else k95v
    records.append(["session1_train",target,len(used),C0,k,r2,rmse,*k21v,*k95v,*applied,"Kjoint" if joint_valid else "K95"])
    plot_session(tagged,used,C0,k,k21v,k95v,"Session 1 fitting",os.path.join(OUT,"session1_fitting.png"))
    intervals=k21_intervals(used,C0)
    intervals.to_csv(os.path.join(OUT,"session1_k21_intervals.csv"),index=False,encoding="utf-8-sig")
    plot_k21_intervals(intervals,k,os.path.join(OUT,"session1_k21_intervals.png"))
    train_people={target}
    for sn in (2,3):
        ds=normalise(sessions[sn]); val=ds[ds.person.isin(train_people)].copy()
        if val.empty: continue
        # Existing curve: k range fixed; every validation point becomes a new C0.
        vals=[]
        for person,g in val.groupby("person"):
            g = g.sort_values("t")
            durations=[]
            for _,r in g.iterrows():
                cm=max(float(r.C),END)
                predicted=float(np.log(cm/END)/k)
                later=g[(g.t >= r.t) & (g.C <= END)]
                actual_finish=float(later.iloc[0].t) if not later.empty else np.nan
                actual_remaining=actual_finish-float(r.t) if np.isfinite(actual_finish) else np.nan
                relative_error=(abs(predicted-actual_remaining)/actual_remaining*100) if actual_remaining > 0 else np.nan
                durations.append((predicted, float(np.log(cm/END)/k95v[1]), float(np.log(cm/END)/k95v[0]), actual_finish, actual_remaining, relative_error))
            for r,d in zip(g.itertuples(),durations): vals.append([person,r.t,r.C,*d])
        vf=pd.DataFrame(vals,columns=["person","minutes_from_peak","Cm","remaining_min_at_k","remaining_min_at_K95_fast","remaining_min_at_K95_slow","actual_finish_min_from_peak","actual_remaining_min","relative_error_percent"])
        vf.to_csv(os.path.join(OUT,f"session{sn}_validation.csv"),index=False,encoding="utf-8-sig")
        records.append([f"session{sn}_validation","matched only",len(val),np.nan,k,np.nan,np.nan,np.nan,np.nan,np.nan,np.nan,np.nan,np.nan,""])
        # Validation error bars use the same +/-21% rule; the existing k is fixed.
        vv=val.copy(); vv['status']='included'
        plot_session(vv,val,k and float(vv.C.max()),k,(np.nan,np.nan),(np.nan,np.nan),f"Session {sn} validation; fixed k={k:.6f}/min",os.path.join(OUT,f"session{sn}_validation.png"))
    pd.DataFrame(records,columns=["set","selection","n","C0","k_per_min","R2","RMSE","K21_low","K21_high","K95_low","K95_high","applied_k_low","applied_k_high","applied_range"]).to_csv(os.path.join(OUT,"summary.csv"),index=False,encoding="utf-8-sig")
    print(pd.read_csv(os.path.join(OUT,"summary.csv")).to_string(index=False))
    print("matched training people:", sorted(train_people))
    print("outputs:", OUT)

if __name__ == "__main__": main()
