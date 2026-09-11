import json, html
from collections import defaultdict
cat=json.load(open('src/catalogo-mexico.json',encoding='utf8'))
acc=json.load(open('src/accesorios-mexico.json',encoding='utf8'))
def money(x): return '' if x is None else f'${x:,.2f}'
def precio_impreso(x):
    # Precio operativo: 60x12 madera/redila abierta = 60x10 + 2 pies.
    if (x.get('codigoLista')=='CB9' and x.get('medidas')=='60" x 12\'' and
        x.get('capacidad')=='1.5 ton' and 'abierto / madera' in str(x.get('especificaciones','')).lower()):
        return 43498.74
    if (x.get('codigoLista')=='CB9' and x.get('medidas')=='60" x 12\'' and
        x.get('capacidad')=='1.5 ton' and 'abierto / lámina' in str(x.get('especificaciones','')).lower()):
        return 48609.10
    return x.get('precio')
groups=defaultdict(list)
for x in cat:
    try:
        w=float(x.get('medidas','').split('"')[0]); l=float(x.get('medidas','').split('x')[1].replace("'",''))
    except: continue
    txt=(x.get('especificaciones','')+' '+x.get('nombre','')).lower()
    piso='lámina' if ('lamina' in txt or 'lámina' in txt) else ('madera' if 'madera' in txt else 'piso no especificado')
    redila='sin redila' if 'sin redila' in txt else ('cerrada' if 'cerrad' in txt else ('abierta' if 'abiert' in txt else 'redila no especificada'))
    grupo=f"piso {piso}; redila {redila}" if x.get('tipo')=='cama_baja' else ''
    groups[(x.get('tipo',''),w,x.get('capacidad',''),grupo)].append((l,x))
rows=[]
for key,items in sorted(groups.items()):
    items.sort(key=lambda z:z[0]); tarifas=[]
    for i,(l1,x1) in enumerate(items):
        for l2,x2 in items[i+1:]:
            if l2!=l1 and x1.get('precio') is not None and x2.get('precio') is not None:
                d=(x2['precio']-x1['precio'])/(l2-l1)
                if d>0: tarifas.append(d)
    # Una tarifa negativa no representa un costo por pie: normalmente indica
    # que el modelo comparado trae accesorios/equipamiento diferente.
    tarifas=[t for t in tarifas if t>0]
    pie=sum(tarifas)/len(tarifas) if tarifas else None
    for l,x in items:
        rows.append(f"<tr><td>{html.escape(x.get('codigoLista',''))}</td><td>{html.escape(x.get('tipo',''))}</td><td>{html.escape(x.get('medidas',''))}</td><td>{html.escape(x.get('capacidad',''))}</td><td>{money(x.get('precio'))}</td><td>{html.escape(x.get('especificaciones',''))}</td></tr>")
summary=[]; resumen={}
for (tipo,w,cap,grupo),items in sorted(groups.items()):
    vals=[]
    ordenados=sorted(items,key=lambda z:z[0])
    for i,(l1,x1) in enumerate(ordenados):
        for l2,x2 in ordenados[i+1:]:
            if l2!=l1 and x2.get('precio') is not None and x1.get('precio') is not None:
                d=(x2['precio']-x1['precio'])/(l2-l1)
                if d>0: vals.append(d)
    tarifa=sum(vals)/len(vals) if vals else None
    # Si los modelos de una misma variante tienen precios casi iguales, la
    # diferencia directa produce tarifas artificialmente pequeñas (ej. $62).
    # En ese caso prevalece el cálculo base solicitado: precio por pie × 1.15.
    if ordenados:
        largos={z[0] for z in ordenados}
        referencia=next((z for z in ordenados if z[1].get('precio')),None)
        fallback=(referencia[1]['precio']/referencia[0])*1.15 if referencia else None
        if len(largos)==1 and fallback:
            tarifa=fallback
        elif fallback and (tarifa is None or tarifa < fallback*0.5):
            tarifa=fallback
    # Mantener separadas las variantes de cama baja por piso y redila,
    # aunque por casualidad tengan la misma tarifa.
    clave=(tipo,cap,int(w),grupo,round(tarifa or 0,2))
    resumen.setdefault(clave,[]).extend((x.get('codigoLista',''),grupo) for _,x in items)
for (tipo,cap,w,grupo,tarifa),codigos in sorted(resumen.items()):
    familia=tipo.replace('_',' ').title()
    etiqueta=grupo.replace('piso ','').replace('; redila ',' · ') if grupo else ''
    specs=', '.join(sorted(set(c for c,g in codigos))) if codigos else 'Sin referencias comparables'
    if etiqueta:
        specs=f"{etiqueta}; modelos: {specs}"
    summary.append(f"<tr><td>{html.escape(familia)}</td><td>{html.escape(cap)}</td><td>{w}\"</td><td>{money(tarifa) if tarifa>0 else ''}</td><td>Modelos: {html.escape(specs)}</td></tr>")
# Bloques separados por familia para impresión y consulta rápida.
def bloques(html_rows, indice=0):
    out=[]; actual=None
    for row in html_rows:
        import re
        c=re.findall(r'<td>(.*?)</td>',row)
        c=c[indice] if len(c)>indice else None
        familia=html.unescape(c) if c else ''
        if familia!=actual:
            out.append(f'<tr class="familia"><th colspan="{6 if indice==0 else 5}">{html.escape(familia)}</th></tr>'); actual=familia
        out.append(row)
    return ''.join(out)
summary_html=bloques(summary,0)
rows_html=bloques(rows,1)
seen=set(); clean=[]
for x in acc:
    n=x.get('nombre','').lower();
    if 'frenos adicionales' in n: key='frenos adicionales'; x={**x,'nombre':'Frenos adicionales','precio':3500}
    elif 'control de freno' in n: key='control de freno'; x={**x,'nombre':'Control de freno','precio':3000}
    elif 'porta extra' in n: key='porta extra'; x={**x,'nombre':'Porta extra','precio':800}
    elif 'gato de 7' in n: key='gato 7000'; x={**x,'nombre':'Gato mecánico 7,000 lbs','precio':1450}
    elif 'cachucha' in n: key='cachucha'; x={**x,'nombre':'Cachucha','precio':10000}
    elif 'puerta lateral' in n: key='puerta lateral ganadero' if 'ganadero' in x.get('id','').lower() else 'puerta lateral cama baja'; x={**x,'nombre':'Puerta lateral Ganadero' if 'ganadero' in key else 'Puerta lateral Cama Baja','precio':2500 if 'ganadero' in key else 1500}
    elif 'llanta y rin 750' in n: key='llanta 750-16'; x={**x,'nombre':'Llanta y rin 750-16','precio':3500}
    elif 'llanta y rin 700' in n: key='llanta 700-15'; x={**x,'nombre':'Llanta y rin 700-15','precio':2200}
    else: key=x.get('nombre','').lower()
    if key not in seen: clean.append(x); seen.add(key)
clean.append({'categoria':'Carrocería','nombre':'Lona','precio':7000,'unidad':'pieza'})
accrows=''.join(f"<tr><td>{html.escape(x.get('categoria',''))}</td><td>{html.escape(x.get('nombre',''))}</td><td>{money(x.get('precio'))}</td><td>{html.escape(x.get('unidad',''))}</td></tr>" for x in sorted(clean,key=lambda x:(x.get('categoria',''),x.get('nombre',''))))
doc='''<!doctype html><meta charset="utf-8"><title>AMACSA · Lista de respaldo México</title><style>body{font:11px Arial;color:#19342a;margin:18px}h1,h2{color:#006931}h2{border-left:6px solid #f2c500;padding-left:8px}table{border-collapse:collapse;width:100%;margin:10px 0 24px}th,td{border:1px solid #c9d8d0;padding:5px;text-align:left}th{background:#eaf5ed}.familia th{background:#006931;color:white;font-size:13px}tr{break-inside:avoid}.nota{background:#fff5d6;padding:9px;border:1px solid #e5c76b}@media print{button{display:none}@page{size:A4 landscape;margin:10mm}body{font-size:8px}}</style><button onclick="print()">Imprimir</button><h1>AMACSA · Lista de precios de respaldo — México</h1><p>Precios MXN con IVA incluido. Usar cuando no haya sistema, internet o electricidad.</p><p class="nota"><b>Pie extra:</b> cada tarifa se calcula solo con modelos del mismo tipo, ancho y capacidad; Cama Baja además separa piso y redila.</p><h2>Tarifas por pie extra — separadas por remolque</h2><table><thead><tr><th>Familia</th><th>Capacidad</th><th>Ancho</th><th>Precio por pie extra (MXN)</th><th>Especificaciones</th></tr></thead><tbody>''' + summary_html + '''</tbody></table><h2>Modelos base — separados por remolque</h2><table><thead><tr><th>Modelo</th><th>Familia</th><th>Medida</th><th>Capacidad</th><th>Precio base</th><th>Especificaciones</th></tr></thead><tbody>''' + rows_html + '''</tbody></table><h2>Accesorios y cargos adicionales (sin duplicados)</h2><table><thead><tr><th>Categoría</th><th>Accesorio</th><th>Precio</th><th>Unidad</th></tr></thead><tbody>''' + accrows + '''</tbody></table><p><b>Reglas:</b> Torflex en Ganadero Ganso cambia 76″ a 79″ y requiere freno en cada eje. Techo: $800 por pie lineal.</p>'''
open('Lista-respaldo-precios-Mexico.html','w',encoding='utf8').write(doc)

# Formato de impresión grande: una ficha por familia y variante de piso/redila.
familias=[]
for (tipo,w,cap,grupo),items in sorted(groups.items()):
    familia=tipo.replace('_',' ').title(); etiqueta=grupo.replace('piso ','').replace('; redila ',' · ') if grupo else ''
    key=(familia,etiqueta,int(w),cap); bloque=next((b for b in familias if b[0]==key),None)
    if not bloque: bloque=[key,[]]; familias.append(bloque)
    bloque[1].extend(items)
cards=[]; familia_anterior=None
orden={'Cama Baja':0,'Ganadero Ganso':1,'Ganadero Redondo':1,'Cama Alta':2,'Volteo':3,'Caja Seca':4}
familias.sort(key=lambda b:(orden.get(b[0][0],99),b[0][0],b[0][2],b[0][3],b[0][1]))
for (familia,etiqueta,ancho,capacidad),items in familias:
    items.sort(key=lambda z:z[0])
    # tarifa usando el mismo cálculo de la tabla principal
    vals=[(b[1]['precio']-a[1]['precio'])/(b[0]-a[0]) for i,a in enumerate(items) for b in items[i+1:] if b[0]!=a[0] and a[1].get('precio') is not None and b[1].get('precio') is not None and (b[1]['precio']-a[1]['precio'])/(b[0]-a[0])>0]
    tarifa=sum(vals)/len(vals) if vals else None
    referencia=next((z for z in items if z[1].get('precio')),None)
    fallback=(referencia[1]['precio']/referencia[0])*1.15 if referencia else None
    if fallback and (tarifa is None or tarifa < fallback*0.5): tarifa=fallback
    # Ajuste operativo para la variante Cama Baja 60 x 12, 1.5 ton,
    # madera/redila abierta: dos pies sobre el modelo de 10 pies.
    if familia=='Cama Baja' and ancho==60 and capacidad=='1.5 ton' and any('abierto / madera' in str(x.get('especificaciones','')).lower() for _,x in items):
        items=[(l,({**x,'precio':round(next((y['precio'] for ll,y in items if ll==10 and y.get('codigoLista')=='CB1'),x['precio'])+2*fallback,2)} if x.get('codigoLista')=='CB9' and l==12 and fallback else x)) for l,x in items]
    base=''.join(f'<tr><td>{html.escape(x.get("codigoLista",""))}</td><td>{html.escape(x.get("medidas",""))}</td><td>{html.escape(x.get("capacidad",""))}</td><td><b>{money(precio_impreso(x))}</b></td><td>{html.escape(x.get("especificaciones","") or "Sin especificación")}</td></tr>' for _,x in items)
    salto='' if familia_anterior is None else ' style="break-before:page;page-break-before:always"'
    clase=' primera-familia' if familia_anterior is None else ''
    encabezado='' if familia==familia_anterior else f'<div class="familia-titulo{clase}"{salto}>{html.escape(familia)}</div>'
    familia_anterior=familia
    cards.append(encabezado+f'<section class="card"><h2>{html.escape(familia)} · {ancho}&quot; · {html.escape(capacidad)}{(" · "+html.escape(etiqueta)) if etiqueta else ""}</h2><h3>Precio base</h3><table><tr><th>Modelo</th><th>Medida</th><th>Capacidad</th><th>Precio base MXN</th></tr>{base}</table><h3>Tarifa por pie extra</h3><div class="tarifa">{money(tarifa) if tarifa and tarifa>0 else "Consultar"} <small>por pie extra · ancho y capacidad indicados arriba</small></div></section>')
doc_grande='''<!doctype html><meta charset="utf-8"><title>AMACSA · Lista México</title><style>body{font:15px Arial;color:#19342a;margin:18px}h1{color:#006931;font-size:27px;border-bottom:4px solid #006931;padding-bottom:8px}h2{background:#006931;color:white;padding:9px;margin:0}h3{color:#006931;margin:12px 0 5px}.card{border:2px solid #006931;border-radius:8px;margin:14px 0;padding:0 12px 12px;break-inside:avoid}table{border-collapse:collapse;width:100%;margin:4px 0 10px}th,td{border:1px solid #9ab9a8;padding:8px;text-align:left}th{background:#eaf5ed}.tarifa{font-size:24px;font-weight:bold;color:#006931;border:2px solid #f2c500;padding:10px}.tarifa small{font-size:13px;color:#19342a}@page{size:letter portrait;margin:12mm}@media print{button{display:none}}</style><button onclick="print()">Imprimir</button><h1>AMACSA · Lista de precios de respaldo — México</h1><p>Precios MXN con IVA incluido. Cada cuadro separa remolque, piso y redila.</p>''' + ''.join(cards) + '''<h2>Accesorios y cargos adicionales</h2><table><tr><th>Accesorio</th><th>Precio MXN</th></tr>''' + ''.join(f'<tr><td>{html.escape(x.get("nombre",""))}</td><td>{money(x.get("precio"))}</td></tr>' for x in clean) + '''</table>'''
# Corrección confirmada de la variante Cama Baja 60 x 12, 1.5 ton,
# madera y redila abierta: dos pies sobre el modelo 60 x 10.
doc_grande=doc_grande.replace('$36,412.63','$43,498.74')
doc_grande=doc_grande.replace('<th>Precio base MXN</th></tr>','<th>Precio base MXN</th><th>Especificación completa</th></tr>')
doc_grande=doc_grande.replace('</style>',' .familia-titulo{font-size:32px!important;font-weight:900!important;background:#006931;color:#fff;padding:14px;margin-top:22px;border-radius:8px}</style>')
doc_grande=doc_grande.replace('</style>',' .primera-familia{break-before:auto!important;page-break-before:auto!important}</style>')
doc_grande=doc_grande.replace('<div class="familia-titulo">','<div class="familia-titulo" style="break-before:page;page-break-before:always">')
doc_grande=doc_grande.replace('<h2>Accesorios y cargos adicionales</h2>','<h2 style="break-before:page;page-break-before:always">Accesorios y cargos adicionales</h2>')
open('Lista-respaldo-Mexico-fichas.html','w',encoding='utf8').write(doc_grande)
